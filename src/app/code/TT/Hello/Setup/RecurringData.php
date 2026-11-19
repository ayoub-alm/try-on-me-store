<?php
/**
 * TemplateToaster theme helper module.
 */
declare(strict_types=1);

namespace TT\Hello\Setup;

use Magento\Framework\Component\ComponentRegistrar;
use Magento\Framework\Component\ComponentRegistrarInterface;
use Magento\Framework\Setup\InstallDataInterface;
use Magento\Framework\Setup\ModuleContextInterface;
use Magento\Framework\Setup\ModuleDataSetupInterface;

/**
 * Runs on every setup:upgrade, after Magento_Theme has registered the themes.
 *
 * Magento never updates a theme that is already registered. A TemplateToaster theme installed before its theme.xml
 * named Magento/blank as parent therefore keeps parent_id NULL after an update and misses Blank's image sizes
 * (etc/view.xml), email styles and fonts. This sets the parent from theme.xml for TemplateToaster themes only
 * (recognised by web/css/magento_static.css) that have none in the database.
 *
 * Magento also marks a theme "virtual" when its folder is missing during setup:upgrade (e.g. deleted before a
 * reinstall) and never marks it physical again once the files are back: the store then renders Blank without the
 * theme's layouts and templates. This restores TemplateToaster themes whose files are present to physical.
 */
class RecurringData implements InstallDataInterface
{
    /**
     * @var ComponentRegistrarInterface
     */
    private $componentRegistrar;

    /**
     * @param ComponentRegistrarInterface $componentRegistrar
     */
    public function __construct(ComponentRegistrarInterface $componentRegistrar)
    {
        $this->componentRegistrar = $componentRegistrar;
    }

    /**
     * @inheritdoc
     */
    public function install(ModuleDataSetupInterface $setup, ModuleContextInterface $context)
    {
        $connection = $setup->getConnection();
        $table = $setup->getTable('theme');
        $themes = $connection->fetchAll(
            $connection->select()
                ->from($table, ['theme_id', 'theme_path', 'parent_id', 'type'])
                ->where('area = ?', 'frontend')
                ->where('parent_id IS NULL OR type = ?', 1)
        );
        foreach ($themes as $theme) {
            $dir = $this->componentRegistrar->getPath(ComponentRegistrar::THEME, 'frontend/' . $theme['theme_path']);
            if (!$dir || !is_file($dir . '/web/css/magento_static.css') || !is_file($dir . '/theme.xml')) {
                continue;
            }

            if ((int)$theme['type'] === 1) {
                $connection->update($table, ['type' => 0], ['theme_id = ?' => (int)$theme['theme_id']]);
            }

            if ($theme['parent_id'] !== null) {
                continue;
            }

            $xml = simplexml_load_string((string)file_get_contents($dir . '/theme.xml'));
            $parentPath = $xml !== false && isset($xml->parent) ? trim((string)$xml->parent) : '';
            if ($parentPath === '') {
                continue;
            }

            $parentId = $connection->fetchOne(
                $connection->select()
                    ->from($table, ['theme_id'])
                    ->where('area = ?', 'frontend')
                    ->where('theme_path = ?', $parentPath)
            );
            if ($parentId) {
                $connection->update($table, ['parent_id' => (int)$parentId], ['theme_id = ?' => (int)$theme['theme_id']]);
            }
        }
    }
}
