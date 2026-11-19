<?php
use Magento\Framework\App\Bootstrap;
require __DIR__ . '/../../app/bootstrap.php';
$bootstrap = Bootstrap::create(BP, $_SERVER);
$om = $bootstrap->getObjectManager();
$om->get(\Magento\Framework\App\State::class)->setAreaCode('adminhtml');
$cats = $om->create(\Magento\Catalog\Model\ResourceModel\Category\Collection::class)->addAttributeToSelect(['name','url_key','is_active','include_in_menu'])->setOrder('path','ASC');
foreach ($cats as $c) echo str_repeat('  ', $c->getLevel()), $c->getId(), ' ', $c->getName(), ' [', $c->getUrlKey(), '] active=', $c->getIsActive(), ' menu=', $c->getIncludeInMenu(), "\n";
$p = $om->create(\Magento\Catalog\Model\ResourceModel\Product\Collection::class);
echo "products: ", $p->getSize(), "\n";
foreach ($om->create(\Magento\Store\Model\ResourceModel\Store\Collection::class) as $s) echo 'store ', $s->getId(), ' ', $s->getCode(), ' root=', $s->getGroup()->getRootCategoryId(), "\n";
foreach ($om->create(\Magento\Catalog\Model\ResourceModel\Product\Collection::class)->addAttributeToSelect(['name','price'])->setPageSize(10) as $x) echo 'p ', $x->getSku(), ' ', $x->getName(), ' ', $x->getTypeId(), ' ', $x->getPrice(), "\n";
echo 'default set ', $om->get(\Magento\Catalog\Model\Product::class)->getDefaultAttributeSetId(), "\n";
$cfg = $om->get(\Magento\Framework\App\Config\ScopeConfigInterface::class);
echo 'currency ', $cfg->getValue('currency/options/base'), ' locale ', $cfg->getValue('general/locale/code'), "\n";
foreach (['color','size'] as $code) { $a = $om->get(\Magento\Eav\Model\Config::class)->getAttribute('catalog_product', $code); echo $code, ' id=', (int)$a->getId(), "\n"; }
