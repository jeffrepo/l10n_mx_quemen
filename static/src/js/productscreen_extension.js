odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    models.Order = models.Order.extend({
        add_product: function(product, options) {
            const res = _super_order.add_product.apply(this, arguments);

            Promise.resolve(res).then(() => {
                if (!this._applying_custom_2x1_promos) {
                    this._schedule_custom_2x1_promos();
                }
            });

            return res;
        },

        set_orderline_options: function(line, options) {
            const res = _super_order.set_orderline_options
                ? _super_order.set_orderline_options.apply(this, arguments)
                : undefined;

            this._schedule_custom_2x1_promos();

            return res;
        },

        remove_orderline: function(line) {
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            if (line && line.is_program_reward) {
                const programId = line.program_id || line.reward_id;

                if (programId) {
                    this._manually_removed_program_ids.add(programId);

                    if (Array.isArray(this.activePromoProgramIds)) {
                        this.activePromoProgramIds = this.activePromoProgramIds.filter(id => id !== programId);
                    }
                }
            }

            const res = _super_order.remove_orderline.apply(this, arguments);

            if (!line || !line.is_program_reward) {
                this._schedule_custom_2x1_promos();
            }

            return res;
        },

        resetPrograms: function() {
            this._manually_removed_program_ids = new Set();

            const res = _super_order.resetPrograms
                ? _super_order.resetPrograms.apply(this, arguments)
                : undefined;

            this._schedule_custom_2x1_promos();

            return res;
        },

        _schedule_custom_2x1_promos: function() {
            if (this._custom_2x1_timer) {
                clearTimeout(this._custom_2x1_timer);
            }

            this._custom_2x1_timer = setTimeout(() => {
                this._apply_custom_2x1_promos();
            }, 350);
        },

        _program_intersects_products: function(program, productIds) {
            const validProductIds = program.valid_product_ids instanceof Set
                ? program.valid_product_ids
                : new Set(program.valid_product_ids || []);

            for (const id of validProductIds) {
                if (productIds.has(id)) {
                    return true;
                }
            }

            return false;
        },

        _apply_custom_2x1_promos: async function() {
            if (this._applying_custom_2x1_promos) {
                return;
            }

            this._applying_custom_2x1_promos = true;
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            try {
                const order = this;
                const programs = (order.pos.promo_programs || [])
                    .filter(program => {
                        return program.discount_logic &&
                            program.reward_type === 'discount' &&
                            program.discount_apply_on === 'specific_products';
                    })
                    .sort((a, b) => {
                        const seqA = a.sequence || 0;
                        const seqB = b.sequence || 0;
                        return seqA === seqB ? a.id - b.id : seqA - seqB;
                    });

                const usedProductIds = new Set();

                for (const program of programs) {
                    if (order._manually_removed_program_ids.has(program.id)) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    if (order._program_intersects_products(program, usedProductIds)) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    const check = order._checkProgramRules
                        ? await Promise.resolve(order._checkProgramRules(program))
                        : { successful: true };

                    if (!check || !check.successful) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    const validProductIds = program.valid_product_ids instanceof Set
                        ? program.valid_product_ids
                        : new Set(program.valid_product_ids || []);

                    const discountProductIds = program.discount_specific_product_ids instanceof Set
                        ? program.discount_specific_product_ids
                        : new Set(program.discount_specific_product_ids || []);

                    const rewardProductId = Array.isArray(program.discount_line_product_id)
                        ? program.discount_line_product_id[0]
                        : program.discount_line_product_id;

                    const rewardProduct = order.pos.db.get_product_by_id(rewardProductId);

                    if (!rewardProduct) {
                        console.warn('[l10n_mx_quemen] No existe reward product en POS', program.id, rewardProductId);
                        continue;
                    }

                    const normalLines = order.get_orderlines().filter(line => {
                        return !line.is_program_reward &&
                            line.product &&
                            validProductIds.has(line.product.id);
                    });

                    const totalQty = normalLines.reduce((sum, line) => {
                        return sum + line.get_quantity();
                    }, 0);

                    const minQty = program.rule_min_quantity || 1;

                    if (totalQty < minQty) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    const discountableLines = normalLines.filter(line =>
                        discountProductIds.has(line.product.id)
                    );

                    if (!discountableLines.length) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    const groups = Math.floor(totalQty / minQty);
                    const rewardQtyPerGroup = program.reward_product_quantity || 1;
                    let remainingRewards = groups * rewardQtyPerGroup;

                    if (remainingRewards <= 0) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    const sortedLines = discountableLines
                        .slice()
                        .sort((a, b) => a.get_unit_price() - b.get_unit_price());

                    let totalDiscount = 0;

                    for (const line of sortedLines) {
                        if (remainingRewards <= 0) {
                            break;
                        }

                        const lineQty = line.get_quantity();
                        const qtyToDiscount = Math.min(lineQty, remainingRewards);
                        const percent = program.discount_percentage || 0;

                        totalDiscount += line.get_unit_price() * qtyToDiscount * (percent / 100);
                        remainingRewards -= qtyToDiscount;
                    }

                    totalDiscount = Math.round(totalDiscount * 100) / 100;

                    if (totalDiscount <= 0) {
                        order._remove_custom_reward_lines(program.id);
                        continue;
                    }

                    for (const line of normalLines) {
                        usedProductIds.add(line.product.id);
                    }

                    const existingRewardLines = order.get_orderlines().filter(line =>
                        line.is_program_reward && line.program_id === program.id
                    );

                    if (existingRewardLines.length) {
                        const rewardLine = existingRewardLines[0];

                        rewardLine.set_quantity(1);
                        rewardLine.set_unit_price(-totalDiscount);
                        rewardLine.price_manually_set = true;
                        rewardLine.is_program_reward = true;
                        rewardLine.program_id = program.id;
                        rewardLine.reward_id = program.id;
                        rewardLine.trigger('change', rewardLine);

                        for (const extraLine of existingRewardLines.slice(1)) {
                            order.remove_orderline(extraLine);
                        }

                        console.log(`✅ [program_id: ${program.id}] Precio ajustado: -${totalDiscount}`);
                        continue;
                    }

                    let addOptions = {};

                    if (order._getAddProductOptions) {
                        addOptions = await order._getAddProductOptions(rewardProduct);
                    }

                    await order.add_product(rewardProduct, {
                        ...addOptions,
                        price: -totalDiscount,
                        quantity: 1,
                        merge: false,
                        extras: {
                            reward_id: program.id,
                            price_manually_set: true,
                        },
                    });

                    const rewardLine = order.get_selected_orderline();

                    if (rewardLine) {
                        rewardLine.set_quantity(1);
                        rewardLine.set_unit_price(-totalDiscount);
                        rewardLine.price_manually_set = true;
                        rewardLine.is_program_reward = true;
                        rewardLine.program_id = program.id;
                        rewardLine.reward_id = program.id;
                        rewardLine.trigger('change', rewardLine);

                        console.log(`✅ [program_id: ${program.id}] Línea de descuento creada: -${totalDiscount}`);
                    }
                }
            } finally {
                this._applying_custom_2x1_promos = false;
            }
        },

        _remove_custom_reward_lines: function(programId) {
            const rewardLines = this.get_orderlines().filter(line =>
                line.is_program_reward && line.program_id === programId
            );

            for (const line of rewardLines) {
                this.remove_orderline(line);
            }
        },
    });

    return models.Order;
});
