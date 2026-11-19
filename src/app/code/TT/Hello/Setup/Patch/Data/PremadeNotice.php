<?php
/**
 * TemplateToaster theme helper module.
 */
declare(strict_types=1);

namespace TT\Hello\Setup\Patch\Data;

use Magento\Framework\Setup\ModuleDataSetupInterface;
use Magento\Framework\Setup\Patch\DataPatchInterface;

/**
 * License notice of a free TemplateToaster theme for the store owner.
 *
 * Added once (at the setup:upgrade of the install) to the admin notifications: the bell in the admin header and
 * System > Notifications, where "Mark as Read" or "Remove" hides it. Store visitors never see it.
 */
class PremadeNotice implements DataPatchInterface
{
    /**
     * @var ModuleDataSetupInterface
     */
    private $moduleDataSetup;

    /**
     * @param ModuleDataSetupInterface $moduleDataSetup
     */
    public function __construct(ModuleDataSetupInterface $moduleDataSetup)
    {
        $this->moduleDataSetup = $moduleDataSetup;
    }

    /**
     * @inheritdoc
     */
    public function apply()
    {
        $connection = $this->moduleDataSetup->getConnection();
        $table = $this->moduleDataSetup->getTable('adminnotification_inbox');
        if (!$connection->isTableExists($table)) {
            return $this;
        }

        $connection->insert(
            $table,
            [
                'severity' => 4,
                'date_added' => gmdate('Y-m-d H:i:s'),
                'title' => 'Free Magento theme made with TemplateToaster',
                'description' => 'This free Magento theme was made with TemplateToaster. Please keep the "Designed With TemplateToaster" credit in the footer. With a TemplateToaster license you can fully customize this theme, remove or change the credit, and create unlimited custom themes. Buy a TemplateToaster license: https://templatetoaster.com/purchase',
                'url' => 'https://templatetoaster.com/purchase',
                'is_read' => 0,
                'is_remove' => 0,
            ]
        );
        return $this;
    }

    /**
     * @inheritdoc
     */
    public static function getDependencies()
    {
        return [];
    }

    /**
     * @inheritdoc
     */
    public function getAliases()
    {
        return [];
    }
}
