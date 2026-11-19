<?php
declare(strict_types=1);

namespace Marwa\VirtualTryOn\Plugin;

use Magento\Catalog\Block\Product\Image as ImageBlock;
use Magento\Framework\Escaper;
use Marwa\VirtualTryOn\ViewModel\Config;

/**
 * Adds the "Essayer" badge on top of product images in listings.
 */
class ImageBlockPlugin
{
    public function __construct(
        private readonly Config $config,
        private readonly Escaper $escaper
    ) {
    }

    public function afterToHtml(ImageBlock $subject, string $html): string
    {
        $productId = (int)$subject->getData('product_id');
        $imageId = (string)$subject->getData('vto_image_id');

        if ($html === ''
            || !$productId
            || !$this->config->showOnListing()
            || !in_array($imageId, $this->config->getImageIds(), true)
        ) {
            return $html;
        }

        $name = (string)$subject->getData('vto_product_name');
        $label = $this->config->getBadgeLabel();
        $payload = $this->config->getProductPayload(
            $productId,
            $name,
            (string)$subject->getData('image_url'),
            (string)$subject->getData('vto_product_sku')
        );

        // A <span role="button"> is used because the image usually sits inside the product <a>.
        $badge = sprintf(
            '<span class="vto-badge" role="button" tabindex="0" data-vto-product="%s" aria-label="%s">'
            . '<svg class="vto-badge__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/>'
            . '<circle cx="12" cy="13" r="3.5"/></svg><span class="vto-badge__text">%s</span></span>',
            $this->escaper->escapeHtmlAttr($payload),
            $this->escaper->escapeHtmlAttr(__('Essayer %1 en cabine virtuelle', $name)),
            $this->escaper->escapeHtml($label)
        );

        return '<span class="vto-wrap">' . $html . $badge . '</span>';
    }
}
