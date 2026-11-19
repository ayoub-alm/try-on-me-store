<?php
/**
 * One-off import of Marwa categories and products (data scraped from marwa.com listings).
 * Run inside the container:  php var/marwa-import/import.php
 * Safe to re-run: existing categories (by url key) and products (by SKU) are updated, not duplicated.
 */
use Magento\Framework\App\Bootstrap;
require __DIR__ . '/../../app/bootstrap.php';
$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$om->get(\Magento\Store\Model\StoreManagerInterface::class)->setCurrentStore(0);

const ROOT_ID = 2;
$tree = [
    ['nouveautes', 'Nouveautés', []],
    ['vetements', 'Vêtements', [
        ['robes', 'Robes'], ['blouses-chemises', 'Blouses & Chemises'], ['vestes', 'Vestes'],
        ['manteaux-femme', 'Manteaux'], ['denim', 'Jeans'], ['pantalons', 'Pantalons'], ['pullovers', 'Pullovers'],
        ['t-shirts', 'T-shirts'], ['tuniques', 'Tuniques'], ['combinaisons', 'Combinaisons'],
        ['gilets-kimonos', 'Gilets & Kimonos'], ['comfort-wear', 'Comfort Wear'], ['sportswear', 'Sportswear'],
        ['total-looks', 'Total looks'],
    ]],
    ['accessoires', 'Accessoires', [['chaussures', 'Chaussures'], ['echarpes', 'Écharpes']]],
    ['soldes', 'Soldes', []],
];

$catFactory = $om->get(\Magento\Catalog\Model\CategoryFactory::class);
$catRepo = $om->get(\Magento\Catalog\Api\CategoryRepositoryInterface::class);
$findCat = function (int $parentId, string $urlKey) use ($om) {
    $c = $om->create(\Magento\Catalog\Model\ResourceModel\Category\Collection::class)
        ->addAttributeToFilter('parent_id', $parentId)->addAttributeToFilter('url_key', $urlKey)->getFirstItem();
    return $c->getId() ? (int)$c->getId() : null;
};
$saveCat = function (int $parentId, string $urlKey, string $name, int $pos) use ($findCat, $catFactory, $catRepo) {
    $id = $findCat($parentId, $urlKey);
    $cat = $id ? $catRepo->get($id, 0) : $catFactory->create();
    $cat->setStoreId(0)->setName($name)->setUrlKey($urlKey)->setIsActive(true)->setIncludeInMenu(true)
        ->setIsAnchor(true)->setPosition($pos);
    if (!$id) { $cat->setParentId($parentId); }
    $cat = $catRepo->save($cat);
    echo ($id ? 'updated' : 'created'), " category $name (#{$cat->getId()})\n";
    return (int)$cat->getId();
};

$catIds = [];
$pos = 10;
foreach ($tree as [$key, $name, $children]) {
    $catIds[$key] = $saveCat(ROOT_ID, $key, $name, $pos++);
    $cpos = 1;
    foreach ($children as [$ckey, $cname]) {
        $catIds[$ckey] = $saveCat($catIds[$key], $ckey, $cname, $cpos++);
    }
}

// Keep the old demo category reachable but out of the menu.
if ($oldId = $findCat(ROOT_ID, 'marwa')) {
    $old = $catRepo->get($oldId, 0); $old->setStoreId(0)->setIncludeInMenu(false); $catRepo->save($old);
    echo "hid old category Marwa (#$oldId) from the menu\n";
}

// ---------------- products ----------------
$products = json_decode(file_get_contents(__DIR__ . '/products.json'), true);
$mediaDir = $om->get(\Magento\Framework\Filesystem::class)->getDirectoryWrite(\Magento\Framework\App\Filesystem\DirectoryList::MEDIA);
$mediaDir->create('import/marwa');
$repo = $om->get(\Magento\Catalog\Api\ProductRepositoryInterface::class);
$factory = $om->get(\Magento\Catalog\Model\ProductFactory::class);
$linkMgmt = $om->get(\Magento\Catalog\Api\CategoryLinkManagementInterface::class);
$setId = (int)$om->get(\Magento\Catalog\Model\Product::class)->getDefaultAttributeSetId();
$slug = function (string $s): string {
    $s = transliterator_transliterate('Any-Latin; Latin-ASCII; Lower()', $s);
    return trim(preg_replace('/[^a-z0-9]+/', '-', $s), '-');
};

$done = 0; $fail = 0;
$only = array_filter(explode(',', (string)getenv('ONLY_SKUS')));
foreach ($products as $i => $p) {
    if ($only && !in_array($p['sku'], $only, true)) { continue; }
    try {
        $sku = $p['sku'];
        try { $product = $repo->get($sku, true, 0, true); $isNew = false; }
        catch (\Magento\Framework\Exception\NoSuchEntityException $e) { $product = $factory->create(); $isNew = true; }

        $name = mb_convert_case(mb_strtolower($p['name']), MB_CASE_TITLE, 'UTF-8');
        $product->setStoreId(0)->setSku($sku)->setName($name)->setAttributeSetId($setId)
            ->setTypeId('simple')->setVisibility(4)->setStatus(1)->setWebsiteIds([1])
            ->setPrice((float)$p['price'])->setSpecialPrice($p['special'] !== null ? (float)$p['special'] : null)
            ->setWeight(0.5)->setTaxClassId(0)
            ->setUrlKey($slug($name . ' ' . $sku))
            ->setDescription('<p>' . htmlspecialchars($name) . '.</p><p>Référence : ' . htmlspecialchars($sku) . '</p>')
            ->setShortDescription(htmlspecialchars($name))
            ->setStockData(['use_config_manage_stock' => 1, 'qty' => 100, 'is_in_stock' => 1]);

        if ($isNew) {
            $src = __DIR__ . '/images/' . $p['file'];
            if (is_file($src)) {
                $dest = 'import/marwa/' . strtolower(preg_replace('/[^A-Za-z0-9_-]+/', '_', pathinfo($p['file'], PATHINFO_FILENAME))) . '.' . strtolower(pathinfo($p['file'], PATHINFO_EXTENSION));
                $mediaDir->writeFile($dest, file_get_contents($src));
                $product->addImageToMediaGallery($mediaDir->getAbsolutePath($dest), ['image', 'small_image', 'thumbnail'], true, false);
            }
        }
        $product = $repo->save($product);
        $ids = array_values(array_unique(array_filter(array_map(fn ($k) => $catIds[$k === 'robes-maroc' ? 'robes' : $k] ?? null, $p['cats']))));
        $parents = [];
        foreach ($ids as $cid) { // also put items in the parent (Vêtements / Accessoires)
            foreach (['vetements', 'accessoires'] as $top) {
                foreach ($tree as [$k, , $children]) {
                    if ($k === $top && in_array($cid, array_map(fn ($c) => $catIds[$c[0]], $children), true)) { $parents[] = $catIds[$top]; }
                }
            }
        }
        $linkMgmt->assignProductToCategories($sku, array_values(array_unique(array_merge($ids, $parents))));
        $done++;
        if ($done % 25 === 0) { echo "  $done products...\n"; }
    } catch (\Throwable $e) {
        $fail++; echo "FAIL {$p['sku']}: ", $e->getMessage(), "\n";
    }
}
echo "products imported/updated: $done, failed: $fail\n";
