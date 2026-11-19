/**
 * Marwa_VirtualTryOn - fitting room with live camera.
 *
 * Opens from:
 *   - any element with data-vto-product='{"id":1,"name":"...","image":"...","sku":"..."}' (badges, product button)
 *   - any element with data-vto-open (top-bar "Cabine d'essayage" link)
 *
 * Try-on engines:
 *   1. Built-in API provider: when the API is enabled in the admin, frames are POSTed to the
 *      store proxy (virtualtryon/tryon/process) and the returned image is shown over the video.
 *   2. Custom provider (e.g. a client-side SDK): call
 *        window.MarwaTryOn.registerProvider({
 *            name: 'my-sdk',
 *            start: function (ctx) {},   // ctx.video, ctx.product, ctx.showResult(src), ctx.setStatus(text)
 *            stop: function () {},
 *            productChanged: function (product) {} // optional
 *        });
 *      A registered provider replaces the built-in API provider.
 */
define([], function () {
    'use strict';

    var TRAY_KEY = 'vto_fitting_room';
    var CONSENT_KEY = 'vto_camera_consent';
    var MAX_ITEMS = 12;
    var FRAME_WIDTH = 640;
    var INTRO_DRAW_MS = 1600;   // silhouette drawing before the countdown
    var INTRO_STEP_MS = 800;    // each step of the 3-2-1 countdown
    var INTRO_LEAVE_MS = 600;   // fade from the intro into the live camera
    var GUIDE_VISIBLE_MS = 7000; // live silhouette guide, then it fades out

    var customProvider = null;
    var instance = null;

    function storageGet(key, fallback) {
        try {
            var value = window.localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch (e) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* private mode: keep working without persistence */ }
    }

    function getFormKey() {
        var match = document.cookie.match(/(?:^|;\s*)form_key=([^;]+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
        var input = document.querySelector('input[name="form_key"]');
        return input ? input.value : '';
    }

    function parseProduct(raw) {
        try {
            var p = JSON.parse(raw);
            if (p && p.id) {
                return { id: Number(p.id), name: String(p.name || ''), image: String(p.image || ''), sku: String(p.sku || '') };
            }
        } catch (e) { /* ignore malformed data */ }
        return null;
    }

    function FittingRoom(config, root) {
        this.config = config || {};
        this.root = root;
        this.stream = null;
        this.facingMode = (this.config.camera && this.config.camera.facingMode) || 'user';
        this.mirror = !this.config.camera || this.config.camera.mirror !== false;
        this.tray = storageGet(TRAY_KEY, []);
        this.current = null;
        this.lastFocus = null;
        this.apiTimer = null;
        this.apiBusy = false;
        this.apiActive = false;
        this.introTimers = [];
        this.guideTimer = null;

        var q = function (role) { return root.querySelector('[data-role="' + role + '"]'); };
        this.el = {
            video: q('video'), result: q('result'), status: q('status'),
            consent: q('consent'), consentAccept: q('consent-accept'),
            error: q('error'), errorText: q('error-text'), retry: q('retry'),
            current: q('current'), currentImage: q('current-image'), currentName: q('current-name'),
            tray: q('tray'), trayEmpty: q('tray-empty'), snapshot: q('snapshot'),
            switchBtn: q('switch'), mirrorBtn: q('mirror'), capture: q('capture'),
            intro: q('intro'), introCount: q('intro-count'), introSkip: q('intro-skip'),
            introFrame: q('intro-frame'), introTimer: q('intro-timer'),
            guide: q('guide'), guideToggle: q('guide-toggle'), fullscreen: q('fullscreen'),
            trayPanel: q('tray-panel'), trayHead: q('tray-head'), trayToggle: q('tray-toggle'), trayCount: q('tray-count')
        };
        this.mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
        if (!Array.isArray(this.tray)) {
            this.tray = [];
        }
        this.bind();
        this.renderTray();
        this.updateCount();
    }

    FittingRoom.prototype.bind = function () {
        var self = this;

        // Badges sit inside product links, so listen in the capture phase and stop navigation.
        document.addEventListener('click', function (e) {
            var trigger = e.target.closest && e.target.closest('[data-vto-product], [data-vto-open]');
            if (!trigger) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            self.open(trigger.hasAttribute('data-vto-product') ? parseProduct(trigger.getAttribute('data-vto-product')) : null, trigger);
        }, true);

        document.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('span[data-vto-product]')) {
                e.preventDefault();
                e.stopPropagation();
                self.open(parseProduct(e.target.getAttribute('data-vto-product')), e.target);
            }
            if (e.key === 'Escape' && !self.root.hidden) {
                self.close();
            }
        }, true);

        this.root.querySelectorAll('[data-vto-close]').forEach(function (btn) {
            btn.addEventListener('click', function () { self.close(); });
        });
        this.el.consentAccept.addEventListener('click', function () {
            storageSet(CONSENT_KEY, true);
            self.playIntro();
        });
        this.el.introSkip.addEventListener('click', function () { self.finishIntro(); });
        this.el.fullscreen.addEventListener('click', function () { self.toggleFullscreen(); });
        ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (evt) {
            document.addEventListener(evt, function () { self.syncFullscreen(); });
        });

        // Phone tray: tap the header to expand or collapse it, or swipe up / down on it.
        this.el.trayHead.addEventListener('click', function (e) {
            if (!self.isMobile() || e.target.closest('[data-role="snapshot"]')) {
                return;
            }
            self.setTrayExpanded(!self.el.trayPanel.classList.contains('is-expanded'));
        });
        var touchY = null;
        this.el.trayHead.addEventListener('touchstart', function (e) {
            touchY = e.touches[0].clientY;
        }, { passive: true });
        this.el.trayHead.addEventListener('touchend', function (e) {
            if (touchY === null || !self.isMobile()) {
                return;
            }
            var dy = e.changedTouches[0].clientY - touchY;
            touchY = null;
            if (Math.abs(dy) > 30) {
                e.preventDefault(); // a swipe, not a tap
                self.setTrayExpanded(dy < 0);
            }
        });
        this.el.guideToggle.addEventListener('click', function () {
            if (self.el.guide.hidden) {
                self.showGuide();
            } else {
                self.hideGuide();
            }
        });
        this.el.retry.addEventListener('click', function () { self.startCamera(true); });
        this.el.switchBtn.addEventListener('click', function () {
            self.facingMode = self.facingMode === 'user' ? 'environment' : 'user';
            self.startCamera();
        });
        this.el.mirrorBtn.addEventListener('click', function () {
            self.mirror = !self.mirror;
            self.applyMirror();
        });
        this.el.capture.addEventListener('click', function () { self.capture(); });

        this.el.tray.addEventListener('click', function (e) {
            var remove = e.target.closest('[data-vto-remove]');
            var pick = e.target.closest('[data-vto-pick]');
            if (remove) {
                self.removeFromTray(Number(remove.getAttribute('data-vto-remove')));
            } else if (pick) {
                var item = self.findInTray(Number(pick.getAttribute('data-vto-pick')));
                if (item) {
                    self.setCurrent(item);
                    self.setTrayExpanded(false);
                }
            }
        });

        // Release the camera when the tab is hidden; resume when visible again.
        document.addEventListener('visibilitychange', function () {
            if (self.root.hidden) {
                return;
            }
            if (!self.el.intro.hidden) {
                return; // the intro is still playing; it starts the camera itself
            }
            if (document.hidden) {
                self.stopCamera();
            } else if (storageGet(CONSENT_KEY, false)) {
                self.startCamera();
            }
        });
    };

    /* ---------- open / close ---------- */

    FittingRoom.prototype.open = function (product, trigger) {
        this.lastFocus = trigger || document.activeElement;
        if (product) {
            this.addToTray(product);
            this.setCurrent(product);
        } else if (!this.current && this.tray.length) {
            this.setCurrent(this.tray[0]);
        }
        this.root.hidden = false;
        document.documentElement.classList.add('vto-open');
        this.root.querySelector('[data-vto-close].vto-icon-btn').focus();

        if (storageGet(CONSENT_KEY, false)) {
            this.playIntro();
        } else {
            this.showPanel('consent');
        }
    };

    FittingRoom.prototype.close = function () {
        this.clearIntro();
        this.el.intro.hidden = true;
        this.el.intro.classList.remove('is-playing', 'is-leaving');
        this.stopCamera();
        this.exitFullscreen();
        this.setTrayExpanded(false);
        this.root.hidden = true;
        document.documentElement.classList.remove('vto-open');
        if (this.lastFocus && this.lastFocus.focus) {
            this.lastFocus.focus();
        }
    };

    FittingRoom.prototype.showPanel = function (name, message) {
        this.el.consent.hidden = name !== 'consent';
        this.el.error.hidden = name !== 'error';
        // Keep the intro on screen while it fades out over the starting camera.
        if (!(name === null && this.el.intro.classList.contains('is-leaving'))) {
            this.el.intro.hidden = name !== 'intro';
        }
        if (name === 'error') {
            this.el.errorText.textContent = message || '';
        }
    };

    FittingRoom.prototype.setStatus = function (text) {
        this.el.status.textContent = text || '';
        this.el.status.hidden = !text;
    };

    /* ---------- intro animation + framing guide ---------- */

    // Animated silhouette, tips and a 3-2-1 ring, then the intro fades into the live camera with the guide.
    FittingRoom.prototype.playIntro = function () {
        var self = this;
        var intro = this.el.intro;
        var count = this.el.introCount;
        var timer = this.el.introTimer;
        var frame = this.el.introFrame;

        this.clearIntro();
        this.stopCamera();
        this.setStatus('');
        intro.classList.remove('is-playing', 'is-leaving');
        this.showPanel('intro');
        intro.style.setProperty('--vto-intro-total', (INTRO_DRAW_MS + 3 * INTRO_STEP_MS) + 'ms');
        intro.style.setProperty('--vto-intro-step', INTRO_STEP_MS + 'ms');
        count.textContent = '';
        timer.hidden = true;
        void intro.offsetWidth; // restart the CSS animations
        intro.classList.add('is-playing');
        this.el.introSkip.focus();

        [3, 2, 1].forEach(function (n, i) {
            self.introTimers.push(window.setTimeout(function () {
                count.textContent = String(n);
                timer.hidden = false;
                timer.classList.remove('is-tick');
                frame.classList.remove('is-tick');
                void timer.offsetWidth;
                timer.classList.add('is-tick');
                frame.classList.add('is-tick');
            }, INTRO_DRAW_MS + i * INTRO_STEP_MS));
        });
        this.introTimers.push(window.setTimeout(function () {
            self.finishIntro();
        }, INTRO_DRAW_MS + 3 * INTRO_STEP_MS));
    };

    FittingRoom.prototype.clearIntro = function () {
        this.introTimers.forEach(function (t) { window.clearTimeout(t); });
        this.introTimers = [];
    };

    FittingRoom.prototype.finishIntro = function () {
        var intro = this.el.intro;
        if (intro.classList.contains('is-leaving')) {
            return;
        }
        this.clearIntro();
        if (this.root.hidden) {
            intro.hidden = true;
            return;
        }
        intro.classList.add('is-leaving');
        this.startCamera(true);
        this.introTimers.push(window.setTimeout(function () {
            intro.hidden = true;
            intro.classList.remove('is-playing', 'is-leaving');
        }, INTRO_LEAVE_MS));
    };

    /* ---------- fullscreen ---------- */

    FittingRoom.prototype.fullscreenElement = function () {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    };

    FittingRoom.prototype.toggleFullscreen = function () {
        var self = this;
        if (this.root.classList.contains('is-fullscreen')) {
            this.exitFullscreen();
            return;
        }
        // The CSS class alone fills the screen (fallback for iPhone, which has no element fullscreen);
        // where supported, real fullscreen also hides the browser bars.
        this.root.classList.add('is-fullscreen');
        var req = this.root.requestFullscreen || this.root.webkitRequestFullscreen;
        if (req) {
            try {
                var res = req.call(this.root);
                if (res && res.catch) {
                    res.catch(function () { /* keep the CSS fallback */ });
                }
            } catch (e) { /* keep the CSS fallback */ }
        }
        this.syncFullscreen();
    };

    FittingRoom.prototype.exitFullscreen = function () {
        this.root.classList.remove('is-fullscreen');
        this.nativeFullscreen = false;
        if (this.fullscreenElement()) {
            var exit = document.exitFullscreen || document.webkitExitFullscreen;
            try {
                var res = exit.call(document);
                if (res && res.catch) {
                    res.catch(function () {});
                }
            } catch (e) { /* ignore */ }
        }
        this.syncFullscreen();
    };

    FittingRoom.prototype.syncFullscreen = function () {
        var native = this.fullscreenElement() === this.root;
        if (this.nativeFullscreen && !native) {
            this.root.classList.remove('is-fullscreen'); // left with Esc or a system gesture
        }
        this.nativeFullscreen = native;
        var on = native || this.root.classList.contains('is-fullscreen');
        this.root.classList.toggle('is-fullscreen', on);
        this.el.fullscreen.setAttribute('aria-pressed', String(on));
        this.el.fullscreen.setAttribute('aria-label', this.el.fullscreen.getAttribute(on ? 'data-label-exit' : 'data-label-enter'));
    };

    /* ---------- tray (bottom sheet on phones) ---------- */

    FittingRoom.prototype.isMobile = function () {
        return !!(this.mobileQuery && this.mobileQuery.matches);
    };

    FittingRoom.prototype.setTrayExpanded = function (expanded) {
        this.el.trayPanel.classList.toggle('is-expanded', !!expanded);
        this.el.trayToggle.setAttribute('aria-expanded', String(!!expanded));
    };

    FittingRoom.prototype.showGuide = function () {
        var self = this;
        var guide = this.el.guide;
        window.clearTimeout(this.guideTimer);
        guide.classList.remove('is-fading');
        guide.hidden = false;
        this.el.guideToggle.setAttribute('aria-pressed', 'true');
        this.guideTimer = window.setTimeout(function () { self.hideGuide(); }, GUIDE_VISIBLE_MS);
    };

    FittingRoom.prototype.hideGuide = function (instant) {
        var guide = this.el.guide;
        var toggle = this.el.guideToggle;
        window.clearTimeout(this.guideTimer);
        toggle.setAttribute('aria-pressed', 'false');
        if (instant || guide.hidden) {
            guide.hidden = true;
            guide.classList.remove('is-fading');
            return;
        }
        guide.classList.add('is-fading');
        this.guideTimer = window.setTimeout(function () {
            guide.hidden = true;
            guide.classList.remove('is-fading');
        }, 450);
    };

    /* ---------- camera ---------- */

    FittingRoom.prototype.startCamera = function (withGuide) {
        var self = this;
        this.stopCamera();
        this.showPanel(null);

        if (!window.isSecureContext) {
            this.showPanel('error', 'La caméra nécessite une connexion sécurisée (HTTPS).');
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showPanel('error', 'Votre navigateur ne permet pas d\'utiliser la caméra.');
            return;
        }

        this.setStatus('Ouverture de la caméra…');
        navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: this.facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } }
        }).then(function (stream) {
            if (self.root.hidden) { // closed while waiting for permission
                stream.getTracks().forEach(function (t) { t.stop(); });
                return;
            }
            self.stream = stream;
            self.el.video.srcObject = stream;
            self.applyMirror();
            var play = self.el.video.play();
            if (play && play.catch) {
                play.catch(function () { /* autoplay is muted; ignore */ });
            }
            self.setStatus('');
            if (withGuide) {
                self.showGuide();
            }
            self.startEngine();
        }).catch(function (err) {
            var name = err && err.name;
            var text = 'Impossible d\'accéder à la caméra.';
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                text = 'Accès refusé. Autorisez la caméra dans les réglages de votre navigateur, puis réessayez.';
            } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
                text = 'Aucune caméra détectée sur cet appareil.';
            } else if (name === 'NotReadableError') {
                text = 'La caméra est déjà utilisée par une autre application.';
            }
            self.setStatus('');
            self.showPanel('error', text);
        });
    };

    FittingRoom.prototype.stopCamera = function () {
        this.stopEngine();
        this.hideGuide(true);
        if (this.stream) {
            this.stream.getTracks().forEach(function (t) { t.stop(); });
            this.stream = null;
        }
        this.el.video.srcObject = null;
        this.el.result.hidden = true;
        this.el.result.removeAttribute('src');
    };

    FittingRoom.prototype.applyMirror = function () {
        var mirrored = this.mirror && this.facingMode === 'user';
        this.el.video.classList.toggle('is-mirrored', mirrored);
        this.el.mirrorBtn.setAttribute('aria-pressed', String(this.mirror));
    };

    FittingRoom.prototype.grabFrame = function (maxWidth, type, quality) {
        var video = this.el.video;
        if (!video.videoWidth) {
            return null;
        }
        var scale = Math.min(1, maxWidth / video.videoWidth);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        var ctx = canvas.getContext('2d');
        if (video.classList.contains('is-mirrored')) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL(type || 'image/jpeg', quality || 0.75);
    };

    FittingRoom.prototype.capture = function () {
        // Prefer the try-on result when the API returned one; otherwise the camera picture.
        var src = !this.el.result.hidden && this.el.result.src ? this.el.result.src : this.grabFrame(1920, 'image/png');
        if (!src) {
            return;
        }
        this.el.snapshot.href = src;
        this.el.snapshot.hidden = false;
        this.root.classList.add('vto-flash');
        var root = this.root;
        window.setTimeout(function () { root.classList.remove('vto-flash'); }, 250);
    };

    /* ---------- try-on engine ---------- */

    FittingRoom.prototype.engineContext = function () {
        var self = this;
        return {
            video: this.el.video,
            product: this.current,
            showResult: function (src) {
                self.el.result.src = src;
                self.el.result.hidden = !src;
            },
            setStatus: function (text) { self.setStatus(text); }
        };
    };

    FittingRoom.prototype.startEngine = function () {
        if (customProvider) {
            try {
                customProvider.start(this.engineContext());
            } catch (e) {
                this.setStatus('');
            }
            return;
        }
        if (this.config.api && this.config.api.enabled) {
            this.apiActive = true;
            this.scheduleApi(0);
        }
    };

    FittingRoom.prototype.stopEngine = function () {
        if (customProvider && customProvider.stop) {
            try { customProvider.stop(); } catch (e) { /* ignore */ }
        }
        this.apiActive = false;
        window.clearTimeout(this.apiTimer);
    };

    FittingRoom.prototype.scheduleApi = function (delay) {
        var self = this;
        window.clearTimeout(this.apiTimer);
        if (!this.apiActive) {
            return;
        }
        this.apiTimer = window.setTimeout(function () { self.sendFrame(); }, delay);
    };

    FittingRoom.prototype.sendFrame = function () {
        var self = this;
        var interval = Math.max(300, Number(this.config.api.interval) || 1500);

        if (!this.apiActive || this.apiBusy || !this.current || document.hidden) {
            if (!this.current) {
                this.setStatus('Choisissez un article pour l\'essayer.');
            }
            this.scheduleApi(interval);
            return;
        }
        var frame = this.grabFrame(FRAME_WIDTH, 'image/jpeg', 0.7);
        if (!frame) {
            this.scheduleApi(300);
            return;
        }

        var body = new FormData();
        body.append('frame', frame);
        body.append('product_id', String(this.current.id));
        body.append('form_key', getFormKey());

        this.apiBusy = true;
        fetch(this.config.api.url, { method: 'POST', body: body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
            })
            .then(function (r) {
                if (r.status === 503 && r.data.error === 'not_configured') {
                    self.apiActive = false; // camera-only mode
                    self.setStatus('');
                    return;
                }
                if (r.data.image) {
                    self.el.result.src = r.data.image;
                    self.el.result.hidden = false;
                    self.setStatus('');
                } else if (r.data.message) {
                    self.setStatus(r.data.message);
                }
            })
            .catch(function () {
                self.setStatus('Connexion au service d\'essayage impossible.');
            })
            .then(function () {
                self.apiBusy = false;
                self.scheduleApi(interval);
            });
    };

    /* ---------- fitting room tray ---------- */

    FittingRoom.prototype.findInTray = function (id) {
        for (var i = 0; i < this.tray.length; i++) {
            if (this.tray[i].id === id) {
                return this.tray[i];
            }
        }
        return null;
    };

    FittingRoom.prototype.addToTray = function (product) {
        this.tray = this.tray.filter(function (p) { return p.id !== product.id; });
        this.tray.unshift(product);
        this.tray = this.tray.slice(0, MAX_ITEMS);
        storageSet(TRAY_KEY, this.tray);
        this.renderTray();
        this.updateCount();
    };

    FittingRoom.prototype.removeFromTray = function (id) {
        this.tray = this.tray.filter(function (p) { return p.id !== id; });
        storageSet(TRAY_KEY, this.tray);
        if (this.current && this.current.id === id) {
            this.setCurrent(this.tray[0] || null);
        }
        this.renderTray();
        this.updateCount();
    };

    FittingRoom.prototype.setCurrent = function (product) {
        this.current = product;
        this.el.current.hidden = !product;
        this.el.result.hidden = true;
        if (product) {
            this.el.currentImage.src = product.image || '';
            this.el.currentImage.hidden = !product.image;
            this.el.currentName.textContent = product.name;
            this.setStatus('');
        }
        if (customProvider && customProvider.productChanged) {
            try { customProvider.productChanged(product); } catch (e) { /* ignore */ }
        }
        this.renderTray();
    };

    FittingRoom.prototype.renderTray = function () {
        var self = this;
        var list = this.el.tray;
        list.textContent = '';
        this.el.trayEmpty.hidden = this.tray.length > 0;

        this.tray.forEach(function (p) {
            var li = document.createElement('li');
            li.className = 'vto-tray__item' + (self.current && self.current.id === p.id ? ' is-active' : '');

            var pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'vto-tray__pick';
            pick.setAttribute('data-vto-pick', String(p.id));
            pick.setAttribute('aria-pressed', String(!!(self.current && self.current.id === p.id)));
            if (p.image) {
                var img = document.createElement('img');
                img.src = p.image;
                img.alt = '';
                img.loading = 'lazy';
                pick.appendChild(img);
            }
            var name = document.createElement('span');
            name.textContent = p.name;
            pick.appendChild(name);

            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'vto-tray__remove';
            remove.setAttribute('data-vto-remove', String(p.id));
            remove.setAttribute('aria-label', 'Retirer ' + p.name);
            remove.textContent = '×';

            li.appendChild(pick);
            li.appendChild(remove);
            list.appendChild(li);
        });
    };

    FittingRoom.prototype.updateCount = function () {
        var n = this.tray.length;
        document.querySelectorAll('[data-vto-count]').forEach(function (el) {
            el.textContent = String(n);
            el.hidden = n === 0;
        });
        this.el.trayCount.textContent = String(n);
        this.el.trayPanel.classList.toggle('is-empty', n === 0);
    };

    /* ---------- public API ---------- */

    window.MarwaTryOn = window.MarwaTryOn || {};
    window.MarwaTryOn.registerProvider = function (provider) {
        if (!provider || typeof provider.start !== 'function') {
            throw new Error('MarwaTryOn provider needs a start(ctx) function');
        }
        if (instance) {
            instance.stopEngine();
        }
        customProvider = provider;
        if (instance && instance.stream) {
            instance.startEngine();
        }
    };
    window.MarwaTryOn.open = function (product) { if (instance) { instance.open(product || null); } };
    window.MarwaTryOn.close = function () { if (instance) { instance.close(); } };
    window.MarwaTryOn.addToFittingRoom = function (product) { if (instance && product) { instance.addToTray(product); } };

    return function (config, element) {
        if (!instance) {
            instance = new FittingRoom(config, element);
        }
        return instance;
    };
});
