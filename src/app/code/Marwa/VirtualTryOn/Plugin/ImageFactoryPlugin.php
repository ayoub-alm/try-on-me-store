<?php
declare(strict_types=1);

namespace Marwa\VirtualTryOn\Plugin;

use Magento\Catalog\Block\Product\Image as ImageBlock;
use Magento\Catalog\Block\Product\ImageFactory;
use Magento\Catalog\Model\Product;

/**
 * Remembers which image type and product an image block was built for,
 * so the badge can be limited to listing images.
 */
class ImageFactoryPlugin
{
    public function afterCreate(
        ImageFactory $subject,
        ImageBlock $result,
        Product $product,
        string $imageId,
        ?array $attributes = null
    ): ImageBlock {
        $result->setData('vto_image_id', $imageId);
        $result->setData('vto_product_name', (string)$product->getName());
        $result->setData('vto_product_sku', (string)$product->getSku());
        return $result;
    }
}
