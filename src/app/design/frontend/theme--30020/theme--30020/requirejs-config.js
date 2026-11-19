// File: app/design/frontend/Vendor/theme/requirejs-config.js
var config = {
 'shim': {
 'js/bootstrap.min': { 'deps': ['jquery'] },
 'js/tt_animation': { 'deps': ['jquery', 'jquery-ui-modules/effect'] },
 'js/tt_slideshow': { 'deps': ['jquery', 'jquery-ui-modules/effect'] },
 'js/customjs': { 'deps': ['jquery', 'js/tt_animation', 'js/tt_slideshow'] }
 } ,
 deps: [
 'jquery-ui-modules/effect',
 'js/bootstrap.min',
 'js/tt_animation',
'js/tt_slideshow'
,
 'js/customjs',
 'js/html5shiv'
,
 'js/totop'
]
};
