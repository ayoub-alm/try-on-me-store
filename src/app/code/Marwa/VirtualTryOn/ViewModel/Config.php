<?php
declare(strict_types=1);

namespace Marwa\VirtualTryOn\ViewModel;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Encryption\EncryptorInterface;
use Magento\Framework\Serialize\Serializer\Json;
use Magento\Framework\UrlInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Store\Model\ScopeInterface;

/**
 * Single source of truth for the module settings (Stores > Configuration > Catalog > Virtual Try-On).
 */
class Config implements ArgumentInterface
{
    private const PATH = 'marwa_virtualtryon/';

    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig,
        private readonly EncryptorInterface $encryptor,
        private readonly UrlInterface $urlBuilder,
        private readonly Json $json
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->flag('general/enabled');
    }

    public function showOnListing(): bool
    {
        return $this->isEnabled() && $this->flag('general/show_on_listing');
    }

    public function showOnProductPage(): bool
    {
        return $this->isEnabled() && $this->flag('general/show_on_product_page');
    }

    public function isFittingRoomEnabled(): bool
    {
        return $this->isEnabled() && $this->flag('fitting_room/enabled');
    }

    public function getBadgeLabel(): string
    {
        return $this->value('general/badge_label') ?: (string)__('Essayer');
    }

    public function getFittingRoomLabel(): string
    {
        return $this->value('fitting_room/label') ?: (string)__("Cabine d'essayage");
    }

    /** @return string[] */
    public function getImageIds(): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $this->value('general/image_ids')))));
    }

    public function isApiEnabled(): bool
    {
        return $this->isEnabled() && $this->flag('api/enabled') && $this->getApiEndpoint() !== '';
    }

    public function getApiEndpoint(): string
    {
        $url = $this->value('api/endpoint');
        return str_starts_with($url, 'https://') || str_starts_with($url, 'http://') ? $url : '';
    }

    public function getApiKey(): string
    {
        $key = $this->value('api/api_key');
        return $key === '' ? '' : (string)$this->encryptor->decrypt($key);
    }

    public function getApiTimeout(): int
    {
        return max(3, (int)$this->value('api/timeout') ?: 20);
    }

    public function getFrameInterval(): int
    {
        return max(300, (int)$this->value('api/interval_ms') ?: 1500);
    }

    /**
     * Data for the badge / product-page button (read by the frontend script).
     */
    public function getProductPayload(int $id, string $name, string $image = '', string $sku = ''): string
    {
        return $this->json->serialize(['id' => $id, 'name' => $name, 'image' => $image, 'sku' => $sku]);
    }

    /**
     * Configuration for the Marwa_VirtualTryOn/js/tryon component.
     */
    public function getJsConfig(): string
    {
        return $this->json->serialize([
            'camera' => [
                'facingMode' => $this->value('camera/facing_mode') === 'environment' ? 'environment' : 'user',
                'mirror' => $this->flag('camera/mirror'),
            ],
            'api' => [
                'enabled' => $this->isApiEnabled(),
                'url' => $this->urlBuilder->getUrl('virtualtryon/tryon/process'),
                'interval' => $this->getFrameInterval(),
            ],
        ]);
    }

    private function flag(string $path): bool
    {
        return $this->scopeConfig->isSetFlag(self::PATH . $path, ScopeInterface::SCOPE_STORE);
    }

    private function value(string $path): string
    {
        return trim((string)$this->scopeConfig->getValue(self::PATH . $path, ScopeInterface::SCOPE_STORE));
    }
}
