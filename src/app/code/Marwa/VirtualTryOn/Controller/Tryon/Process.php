<?php
declare(strict_types=1);

namespace Marwa\VirtualTryOn\Controller\Tryon;

use Magento\Catalog\Api\ProductRepositoryInterface;
use Magento\Catalog\Helper\Image as ImageHelper;
use Magento\Framework\App\Action\HttpPostActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\Json as JsonResult;
use Magento\Framework\Controller\Result\JsonFactory;
use Magento\Framework\Exception\NoSuchEntityException;
use Magento\Framework\HTTP\Client\CurlFactory;
use Magento\Framework\Serialize\Serializer\Json;
use Magento\Store\Model\StoreManagerInterface;
use Marwa\VirtualTryOn\ViewModel\Config;
use Psr\Log\LoggerInterface;

/**
 * POST virtualtryon/tryon/process
 *
 * Server-side proxy between the fitting room camera and the external try-on API.
 * Keeps the API key on the server. Form key (CSRF) is validated by Magento for POST requests.
 *
 * Request  (form data): frame = data:image/jpeg;base64,..., product_id = int, form_key
 * External API receives JSON: {"frame": "<data url>", "product": {"id","sku","name","image","url"}}
 * External API must answer JSON: {"image": "<data:image/... or https:// url>"}
 */
class Process implements HttpPostActionInterface
{
    private const MAX_FRAME_LENGTH = 4000000;

    public function __construct(
        private readonly RequestInterface $request,
        private readonly JsonFactory $jsonFactory,
        private readonly Config $config,
        private readonly CurlFactory $curlFactory,
        private readonly ProductRepositoryInterface $productRepository,
        private readonly StoreManagerInterface $storeManager,
        private readonly ImageHelper $imageHelper,
        private readonly Json $json,
        private readonly LoggerInterface $logger
    ) {
    }

    public function execute(): JsonResult
    {
        if (!$this->config->isApiEnabled()) {
            return $this->error('not_configured', (string)__('Le service d\'essayage n\'est pas encore connecté.'), 503);
        }

        $frame = (string)$this->request->getParam('frame');
        if (strlen($frame) > self::MAX_FRAME_LENGTH
            || !preg_match('#^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$#', $frame)
        ) {
            return $this->error('invalid_frame', (string)__('Image de la caméra invalide.'), 400);
        }

        try {
            $storeId = (int)$this->storeManager->getStore()->getId();
            $product = $this->productRepository->getById((int)$this->request->getParam('product_id'), false, $storeId);
        } catch (NoSuchEntityException) {
            return $this->error('invalid_product', (string)__('Article introuvable.'), 404);
        }

        $payload = $this->json->serialize([
            'frame' => $frame,
            'product' => [
                'id' => (int)$product->getId(),
                'sku' => (string)$product->getSku(),
                'name' => (string)$product->getName(),
                'image' => $this->imageHelper->init($product, 'product_page_image_large')->getUrl(),
                'url' => $product->getProductUrl(),
            ],
        ]);

        try {
            $curl = $this->curlFactory->create();
            $curl->setTimeout($this->config->getApiTimeout());
            $curl->addHeader('Content-Type', 'application/json');
            $curl->addHeader('Accept', 'application/json');
            $apiKey = $this->config->getApiKey();
            if ($apiKey !== '') {
                $curl->addHeader('Authorization', 'Bearer ' . $apiKey);
            }
            $curl->post($this->config->getApiEndpoint(), $payload);

            $status = $curl->getStatus();
            $body = $curl->getBody();
            if ($status < 200 || $status >= 300) {
                $this->logger->warning('Virtual try-on API returned HTTP ' . $status);
                return $this->error('api_error', (string)__('Le service d\'essayage est indisponible.'), 502);
            }

            $data = $this->json->unserialize($body);
            $image = is_array($data) ? (string)($data['image'] ?? '') : '';
            if (!preg_match('#^(data:image/(jpeg|png|webp);base64,|https://)#', $image)) {
                return $this->error('api_error', (string)__('Réponse du service d\'essayage invalide.'), 502);
            }

            return $this->jsonFactory->create()->setData(['image' => $image]);
        } catch (\Throwable $e) {
            $this->logger->error('Virtual try-on API call failed: ' . $e->getMessage());
            return $this->error('api_error', (string)__('Le service d\'essayage est indisponible.'), 502);
        }
    }

    private function error(string $code, string $message, int $httpCode): JsonResult
    {
        return $this->jsonFactory->create()
            ->setHttpResponseCode($httpCode)
            ->setData(['error' => $code, 'message' => $message]);
    }
}
