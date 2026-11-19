<?php
declare(strict_types=1);

namespace Marwa\VirtualTryOn\Model\Config\Source;

use Magento\Framework\Data\OptionSourceInterface;

class FacingMode implements OptionSourceInterface
{
    public function toOptionArray(): array
    {
        return [
            ['value' => 'user', 'label' => __('Front camera (selfie)')],
            ['value' => 'environment', 'label' => __('Back camera')],
        ];
    }
}
