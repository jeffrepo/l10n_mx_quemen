odoo.define('l10n_mx_quemen.OrderExtension', function(require) {
    'use strict';

    const models = require('point_of_sale.models');
    const _super_order = models.Order.prototype;

    const DEBUG_PROMO = true;

    function log() {
        if (DEBUG_PROMO) {
            console.log.apply(console, ['[PROMO_CUSTOM]'].concat(Array.from(arguments)));
        }
    }

    function warn() {
        if (DEBUG_PROMO) {
            console.warn.apply(console, ['[PROMO_CUSTOM]'].concat(Array.from(arguments)));
        }
    }

    models.Order = models.Order.extend({
        add_product: function(product, options) {
            const res = _super_order.add_product.apply(this, arguments);

            Promise.resolve(res).then(() => {
                if (!this._applying_custom_2x1_promos) {
                    this._schedule_custom_2x1_promos('add_product');
                }
            });

            return res;
        },

        set_orderline_options: function(line, options) {
            const res = _super_order.set_orderline_options
                ? _super_order.set_orderline_options.apply(this, arguments)
                : undefined;

            this._schedule_custom_2x1_promos('set_orderline_options');

            return res;
        },

        remove_orderline: function(line) {
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            const programId = this._get_program_id_from_reward_line(line);
            const isRewardLine = line && (
                line.is_program_reward ||
                line.program_id ||
                line.reward_id ||
                programId
            );

            const manualRemove = isRewardLine && line._manual_reward_remove_requested;

            log('remove_orderline', {
                product_id: line && line.product && line.product.id,
                product: line && line.product && line.product.display_name,
                is_program_reward: line && line.is_program_reward,
                program_id: line && line.program_id,
                reward_id: line && line.reward_id,
                resolved_program_id: programId,
                manualRemove: manualRemove,
                suppress: this._suppress_reward_manual_remove,
                price: line && line.get_unit_price && line.get_unit_price(),
            });

            if (manualRemove && !this._suppress_reward_manual_remove) {
                if (programId) {
                    log('Promo eliminada manualmente', programId);
                    this._manually_removed_program_ids.add(programId);

                    if (Array.isArray(this.activePromoProgramIds)) {
                        this.activePromoProgramIds = this.activePromoProgramIds.filter(id => id !== programId);
                    }
                }
            }

            const res = _super_order.remove_orderline.apply(this, arguments);

            if (!isRewardLine) {
                this._schedule_custom_2x1_promos('remove_normal_line');
            }

            return res;
        },

        resetPrograms: function() {
            log('resetPrograms: limpiando eliminaciones manuales');
            this._manually_removed_program_ids = new Set();

            const res = _super_order.resetPrograms
                ? _super_order.resetPrograms.apply(this, arguments)
                : undefined;

            this._schedule_custom_2x1_promos('resetPrograms');

            return res;
        },

        _schedule_custom_2x1_promos: function(reason) {
            if (this._custom_2x1_timer) {
                clearTimeout(this._custom_2x1_timer);
            }

            log('schedule recalculo', reason);

            this._custom_2x1_timer = setTimeout(() => {
                this._apply_custom_2x1_promos(reason);
            }, 450);
        },

        _get_discount_logic_programs: function() {
            return (this.pos.promo_programs || [])
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
        },

        _remove_discount_logic_from_active_programs: function(programs) {
            if (!Array.isArray(this.activePromoProgramIds)) {
                return;
            }

            const customIds = new Set(programs.map(p => p.id));
            const before = this.activePromoProgramIds.slice();

            this.activePromoProgramIds = this.activePromoProgramIds.filter(id => !customIds.has(id));

            if (before.length !== this.activePromoProgramIds.length) {
                log('activePromoProgramIds limpiado para discount_logic', {
                    before: before,
                    after: this.activePromoProgramIds,
                });
            }
        },

        _get_program_id_from_reward_line: function(line) {
            if (!line) {
                return false;
            }

            if (line.program_id || line.reward_id) {
                return line.program_id || line.reward_id;
            }

            if (!line.product || !this.pos || !this.pos.promo_programs) {
                return false;
            }

            const program = this.pos.promo_programs.find(p => {
                const rewardProductId = Array.isArray(p.discount_line_product_id)
                    ? p.discount_line_product_id[0]
                    : p.discount_line_product_id;

                return rewardProductId === line.product.id;
            });

            return program ? program.id : false;
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

        _get_program_reward_lines: function(program) {
            const rewardProductId = Array.isArray(program.discount_line_product_id)
                ? program.discount_line_product_id[0]
                : program.discount_line_product_id;

            return this.get_orderlines().filter(line => {
                if (!line || !line.product) {
                    return false;
                }

                return (
                    (line.is_program_reward && line.program_id === program.id) ||
                    line.program_id === program.id ||
                    line.reward_id === program.id ||
                    line.product.id === rewardProductId
                );
            });
        },

        _mark_reward_line: function(line, program, amount) {
            line.set_quantity(1);
            line.set_unit_price(-amount);
            line.price_manually_set = true;
            line.is_program_reward = true;
            line.program_id = program.id;
            line.reward_id = program.id;
            line.trigger('change', line);
        },

        _minutes_from_custom_date: function(date) {
            return date.getHours() * 60 + date.getMinutes();
        },

        _custom_time_in_range: function(currentMinutes, startMinutes, endMinutes) {
            if (startMinutes === endMinutes) {
                return true;
            }

            if (startMinutes < endMinutes) {
                return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
            }

            return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        },

        _check_discount_logic_program_rules: function(program, normalLines, totalQty) {
            if (!program) {
                return {
                    successful: false,
                    reason: 'Missing program.',
                };
            }

            const minQty = program.rule_min_quantity || 1;

            if (totalQty < minQty) {
                return {
                    successful: false,
                    reason: "Program's minimum quantity is not satisfied.",
                };
            }

            const orderDate = new Date();

            if (program.rule_date_from && program.rule_date_to) {
                const ruleFrom = this._convertToDate(program.rule_date_from);
                const ruleTo = this._convertToDate(program.rule_date_to);

                if (!(orderDate >= ruleFrom && orderDate <= ruleTo)) {
                    return {
                        successful: false,
                        reason: 'Program already expired.',
                    };
                }

                const orderMinutes = this._minutes_from_custom_date(orderDate);
                const ruleFromMinutes = this._minutes_from_custom_date(ruleFrom);
                const ruleToMinutes = this._minutes_from_custom_date(ruleTo);

                if (!this._custom_time_in_range(orderMinutes, ruleFromMinutes, ruleToMinutes)) {
                    return {
                        successful: false,
                        reason: 'Program outside allowed hours.',
                    };
                }
            }

            const partnersDomain = program.rule_partners_domain || '[]';
            if (partnersDomain !== '[]') {
                const customer = this.get_client();
                if (!program.valid_partner_ids || !program.valid_partner_ids.has(customer ? customer.id : 0)) {
                    return {
                        successful: false,
                        reason: "Current customer can't avail this program.",
                    };
                }
            }

            const amountToCheck = normalLines.reduce((sum, line) => {
                if (program.rule_minimum_amount_tax_inclusion === 'tax_included' && line.get_price_with_tax) {
                    return sum + line.get_price_with_tax();
                }

                if (line.get_price_without_tax) {
                    return sum + line.get_price_without_tax();
                }

                return sum + (line.get_unit_price() * line.get_quantity());
            }, 0);

            const minimumAmount = program.rule_minimum_amount || 0;

            // Para discount_logic se valida contra líneas normales, no contra total de la orden,
            // porque la línea reward reduce el total y puede invalidar la promo en el segundo ciclo.
            if (amountToCheck + 0.00001 < minimumAmount) {
                return {
                    successful: false,
                    reason: 'Minimum amount for this program is not satisfied.',
                    amountToCheck: amountToCheck,
                    minimumAmount: minimumAmount,
                };
            }

            return {
                successful: true,
                amountToCheck: amountToCheck,
            };
        },

        _debug_order_lines: function(program) {
            const rewardProductId = program
                ? (Array.isArray(program.discount_line_product_id)
                    ? program.discount_line_product_id[0]
                    : program.discount_line_product_id)
                : false;

            return this.get_orderlines().map(line => ({
                product_id: line.product && line.product.id,
                product: line.product && line.product.display_name,
                qty: line.get_quantity && line.get_quantity(),
                price: line.get_unit_price && line.get_unit_price(),
                is_program_reward: line.is_program_reward,
                program_id: line.program_id,
                reward_id: line.reward_id,
                price_manually_set: line.price_manually_set,
                is_reward_product: rewardProductId && line.product && line.product.id === rewardProductId,
            }));
        },

        _apply_custom_2x1_promos: async function(reason) {
            if (this._applying_custom_2x1_promos) {
                log('recalculo ignorado, ya está corriendo', reason);
                return;
            }

            this._applying_custom_2x1_promos = true;
            this._manually_removed_program_ids = this._manually_removed_program_ids || new Set();

            try {
                const order = this;
                const programs = order._get_discount_logic_programs();

                // Muy importante: las promos discount_logic las maneja este custom.
                // Las quitamos del motor estándar para evitar que pos_coupon cree y borre la misma línea.
                order._remove_discount_logic_from_active_programs(programs);

                log('inicio recalculo', {
                    reason: reason,
                    programs: programs.map(p => [p.id, p.name]),
                    manual_removed: Array.from(order._manually_removed_program_ids),
                    lines: order._debug_order_lines(),
                });

                const usedLineIds = new Set();

                for (const program of programs) {
                    const rewardProductId = Array.isArray(program.discount_line_product_id)
                        ? program.discount_line_product_id[0]
                        : program.discount_line_product_id;

                    const validProductIds = program.valid_product_ids instanceof Set
                        ? program.valid_product_ids
                        : new Set(program.valid_product_ids || []);

                    const discountProductIds = program.discount_specific_product_ids instanceof Set
                        ? program.discount_specific_product_ids
                        : new Set(program.discount_specific_product_ids || []);

                    const normalLines = order.get_orderlines().filter(line => {
                        return !line.is_program_reward &&
                            !line.program_id &&
                            !line.reward_id &&
                            line.product &&
                            validProductIds.has(line.product.id) &&
                            !usedLineIds.has(line.cid);
                    });

                    const totalQty = normalLines.reduce((sum, line) => {
                        return sum + line.get_quantity();
                    }, 0);

                    log('evaluando programa', program.id, program.name, {
                        sequence: program.sequence,
                        minQty: program.rule_min_quantity,
                        rewardProductId: rewardProductId,
                        lines: order._debug_order_lines(program),
                    });

                    if (order._manually_removed_program_ids.has(program.id)) {
                        log('programa saltado por eliminación manual', program.id);
                        order._remove_custom_reward_lines(program.id, 'manual_removed');
                        continue;
                    }


                    const check = order._check_discount_logic_program_rules(program, normalLines, totalQty);

                    log('check discount_logic custom', program.id, check);

                    if (!check || !check.successful) {
                        order._remove_custom_reward_lines(program.id, 'check_failed');
                        continue;
                    }

                    const rewardProduct = order.pos.db.get_product_by_id(rewardProductId);

                    if (!rewardProduct) {
                        warn('No existe reward product en POS', program.id, rewardProductId);
                        continue;
                    }

                    const minQty = program.rule_min_quantity || 1;

                    log('cantidades', program.id, {
                        totalQty: totalQty,
                        minQty: minQty,
                        normalLines: normalLines.map(line => ({
                            product_id: line.product.id,
                            product: line.product.display_name,
                            qty: line.get_quantity(),
                            price: line.get_unit_price(),
                        })),
                    });

                    const discountableLines = normalLines.filter(line =>
                        discountProductIds.has(line.product.id)
                    );

                    if (!discountableLines.length) {
                        order._remove_custom_reward_lines(program.id, 'no_discountable_lines');
                        continue;
                    }

                    const groups = Math.floor(totalQty / minQty);
                    const rewardQtyPerGroup = program.reward_product_quantity || 1;
                    let remainingRewards = groups * rewardQtyPerGroup;

                    if (remainingRewards <= 0) {
                        order._remove_custom_reward_lines(program.id, 'remaining_rewards_zero');
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

                    log('descuento calculado', program.id, {
                        groups: groups,
                        rewardQtyPerGroup: rewardQtyPerGroup,
                        totalDiscount: totalDiscount,
                    });

                    if (totalDiscount <= 0) {
                        order._remove_custom_reward_lines(program.id, 'discount_zero');
                        continue;
                    }

                    for (const line of normalLines) {
                        usedLineIds.add(line.cid);
                    }
                    
                    const existingRewardLines = order._get_program_reward_lines(program);

                    log('reward lines detectadas', program.id, existingRewardLines.map(line => ({
                        product_id: line.product && line.product.id,
                        product: line.product && line.product.display_name,
                        price: line.get_unit_price && line.get_unit_price(),
                        is_program_reward: line.is_program_reward,
                        program_id: line.program_id,
                        reward_id: line.reward_id,
                    })));

                    if (existingRewardLines.length) {
                        const rewardLine = existingRewardLines[0];

                        order._mark_reward_line(rewardLine, program, totalDiscount);

                        if (existingRewardLines.length > 1) {
                            order._suppress_reward_manual_remove = true;
                            try {
                                for (const extraLine of existingRewardLines.slice(1)) {
                                    order.remove_orderline(extraLine);
                                }
                            } finally {
                                order._suppress_reward_manual_remove = false;
                            }
                        }

                        log('línea existente adoptada/ajustada', program.id, -totalDiscount);
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
                        order._mark_reward_line(rewardLine, program, totalDiscount);
                        log('línea de descuento creada', program.id, -totalDiscount);
                    }
                }

                log('fin recalculo', order._debug_order_lines());
            } finally {
                this._applying_custom_2x1_promos = false;
            }
        },

        _remove_custom_reward_lines: function(programId, reason) {
            const program = (this.pos.promo_programs || []).find(p => p.id === programId);
            let rewardLines = [];

            if (program) {
                rewardLines = this._get_program_reward_lines(program);
            } else {
                rewardLines = this.get_orderlines().filter(line =>
                    (line.is_program_reward && line.program_id === programId) ||
                    line.program_id === programId ||
                    line.reward_id === programId
                );
            }

            log('remove_custom_reward_lines', {
                programId: programId,
                reason: reason,
                count: rewardLines.length,
                lines: rewardLines.map(line => ({
                    product_id: line.product && line.product.id,
                    product: line.product && line.product.display_name,
                    price: line.get_unit_price && line.get_unit_price(),
                    is_program_reward: line.is_program_reward,
                    program_id: line.program_id,
                    reward_id: line.reward_id,
                })),
            });

            if (!rewardLines.length) {
                return;
            }

            this._suppress_reward_manual_remove = true;
            try {
                for (const line of rewardLines) {
                    this.remove_orderline(line);
                }
            } finally {
                this._suppress_reward_manual_remove = false;
            }
        },
    });

    return models.Order;
});
