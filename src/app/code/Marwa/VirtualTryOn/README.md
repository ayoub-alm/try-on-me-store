# Marwa_VirtualTryOn

Virtual try-on for Magento 2 / Mage-OS. Works like a plug-in: enable or disable it without touching the theme.

## What it adds

- **"Essayer" badge** on product images in listings and product widgets (home page "Nouveautés", category pages, related/upsell).
- **"Essayer virtuellement" button** on the product page.
- **"Cabine d'essayage" link** in the theme top bar, with a counter of saved items.
- **Fitting room window**: live camera (front/back switch, mirror, photo capture), and a tray of the items the shopper wants to try (kept in the browser).
- **API proxy** `POST /virtualtryon/tryon/process` that forwards camera frames to an external try-on service. The API key stays on the server.

Today the fitting room only opens the camera. Try-on results appear automatically once an API is connected.

## Install / uninstall

```bash
bin/magento module:enable Marwa_VirtualTryOn
bin/magento setup:upgrade
bin/magento cache:flush

# switch off
bin/magento module:disable Marwa_VirtualTryOn && bin/magento cache:flush
```

## Settings

Admin: **Stores > Configuration > Catalog > Virtual Try-On**

| Group | Setting |
|---|---|
| General | Enable, badge on images, button on product page, badge label, image types that get a badge |
| Fitting Room | Show link in top bar, link label |
| Camera | Default camera (front/back), mirror front camera |
| External Try-On API | Enable, endpoint URL, API key (encrypted), frame interval, timeout |

## Connecting an external try-on API

### Option 1: server API (recommended)

Fill in **Endpoint URL** and **API Key**, then set **Enable API = Yes**.

While the camera runs, the browser sends one frame every *Frame Interval* ms to the store, and the store calls your endpoint:

```http
POST <Endpoint URL>
Authorization: Bearer <API Key>
Content-Type: application/json

{
  "frame": "data:image/jpeg;base64,...",
  "product": { "id": 12, "sku": "ROBE-01", "name": "Robe", "image": "https://.../robe.jpg", "url": "https://.../robe.html" }
}
```

Expected answer:

```json
{ "image": "data:image/jpeg;base64,..." }
```

`image` may also be an `https://` URL. It is shown over the live camera. If the API is off, the window stays in camera-only mode.

To adapt to an API with a different format, edit only `Controller/Tryon/Process.php`.

### Option 2: client-side SDK (AR in the browser)

Load the vendor SDK on the page, then register it as the try-on engine:

```js
require(['Marwa_VirtualTryOn/js/tryon'], function () {
    window.MarwaTryOn.registerProvider({
        name: 'vendor-sdk',
        start: function (ctx) {
            // ctx.video: the live <video>; ctx.product: {id, name, image, sku}
            // ctx.showResult(src) draws a result image; ctx.setStatus(text) shows a message
        },
        productChanged: function (product) { /* shopper picked another item */ },
        stop: function () { /* release resources */ }
    });
});
```

A registered provider replaces the built-in API calls.

### JavaScript helpers

```js
window.MarwaTryOn.open({ id: 12, name: 'Robe', image: 'https://...' }); // open with a product
window.MarwaTryOn.open();   // open the fitting room
window.MarwaTryOn.close();
```

## Theme integration

- The top-bar link is added as a child of the theme block `marwa.topbar`. Another theme can render it anywhere with
  `<referenceContainer name="..."><block ... template="Marwa_VirtualTryOn::fitting-room-link.phtml"/></referenceContainer>`.
- Any element with `data-vto-open` opens the fitting room. Any element with `data-vto-product='{"id":..,"name":..,"image":..}'` opens it with that product.

## Notes

- The camera requires HTTPS (or localhost).
- Shoppers see a consent screen before the camera starts. Frames are not stored by the store; they are only forwarded to the external API when it is enabled.
