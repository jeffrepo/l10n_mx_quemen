odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    models.Order = models.Order.extend({
        add_product(product, options) {
            const res = _super_order.add_product.apply(this, arguments);
            console.log("res ", res);

            const selectedProduct = this.get_selected_orderline()?.product;
            console.log("selectedProduct ", selectedProduct);

            if (this.pos.promo_programs && selectedProduct) {
                setTimeout(() => {
                    const rewardLines = this.get_orderlines().filter(line => line.is_program_reward);
                    console.log("rewardLines ", rewardLines);

                    if (!rewardLines.length) {
                        return;
                    }

                    const lastRewardLine = rewardLines[rewardLines.length - 1];
                    const program = this.pos.promo_programs.find(p => p.id === lastRewardLine.program_id);

                    if (
                        program &&
                        program.discount_logic &&
                        program.reward_type === 'discount' &&
                        program.rule_min_quantity
                    ) {
                        // 👉 Aquí verificamos si hay líneas válidas del producto de la promoción
                        const validLines = this
                            .get_orderlines()
                            .filter(l => program.valid_product_ids.has(l.product.id) && !l.is_program_reward);

                        if (!validLines.length) {
                            console.log("⛔ No hay productos válidos en el pedido. No se actualiza rewardLine.");
                            return; // 👈 Salimos sin tocar la línea de recompensa
                        }

                        const appliedQty = validLines.reduce((sum, l) => sum + l.quantity, 0);
                        const minQty = program.rule_min_quantity;
                        const groups = Math.floor(appliedQty / minQty);
                        const allowedRewardQty = groups * (program.reward_product_quantity || 1);

                        if (allowedRewardQty >= 1) {
                            const discountPerUnit = validLines[0].product.lst_price * (program.discount_percentage / 100);
                            const newDiscountTotal = allowedRewardQty * discountPerUnit;
                            lastRewardLine.set_unit_price(-newDiscountTotal);
                            console.log(`✅ Precio ajustado: -${newDiscountTotal} por ${allowedRewardQty} unidad(es)`);
                        } else {
                            lastRewardLine.set_unit_price(0);
                            console.log(`⛔ Descuento eliminado porque no se cumple la cantidad mínima`);
                        }
                    }
                }, 0);

            }

            return res;
        },
    });

    return models.Order;
});

