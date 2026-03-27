/**
 * elsuanfa_GR.js – 2026 Graubünden (GR) 州 EL 算法 [官方 100% 匹配版]
 * 核心依据：SVA Graubünden - Ansätze gültig ab 1.1.2026 & 联邦 ELG 2026 改革
 *
 * @param {Object} inputs - 输入参数对象
 * @param {string|number} inputs.plz - 邮政编码
 * @param {number} inputs.numAdults - 成人数量
 * @param {number} inputs.numChildren - 11岁以下儿童数量
 * @param {number} [inputs.numYoungAdults] - 11岁以上青少年数量
 * @param {number} [inputs.numEducation] - 就学青少年数量（兼容字段）
 * @param {number} inputs.monthlyRent - 月租金
 * @param {number} inputs.taxableIncomeAnnual - 年度应税收入
 * @param {string} [inputs.isReceivingPension] - 是否领取养老金（值为'ahv'时生效）
 * @param {number} inputs.earnedIncomeAnnual - 年度劳动收入
 * @param {number} inputs.taxableAssets - 应税资产总额
 * @param {Object} cantonRules - 州规则配置
 * @param {Object} allPostalData - 邮政编码对应的区域数据
 * @returns {Object} 计算结果（含年度福利、月度福利、资格状态等）
 */
export default function calculateEL_GR(inputs, cantonRules, allPostalData) {
    // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
    const GRUNDBEDARF_2026 = {
        single: 20670,   // Alleinstehende
        couple: 31005    // Ehepaare
    };
    
    if (!inputs || typeof inputs !== 'object') {
        return {
            error: 'err_invalidInput',
            annualBenefit: 0
        };
    }
    const cantonELRules = cantonRules?.el || {};
    const rawPLZ = inputs.plz || "";
    const userPLZ = String(rawPLZ).trim();
    let regionNumber = 3;
    let foundPLZ = false;
    if (userPLZ && allPostalData && allPostalData[userPLZ]) {
        const dbRegion = allPostalData[userPLZ].EL_REGION;
        regionNumber = (dbRegion <= 2) ? 2 : 3;
        foundPLZ = true;
    }
    const regionKey = `region_${regionNumber}`;
    const rentLimits = cantonELRules.rent_limits_monthly?.[regionKey] || {};
    const numAdults = Number(inputs.numAdults) || 1;
    const kidsUnder11 = Number(inputs.numChildren) || 0;
    const kidsOver11 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
    const totalPersons = numAdults + kidsUnder11 + kidsOver11;
    const isCouple = numAdults === 2;
    
    // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
    let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
    
    // 儿童阶梯递减逻辑（保持不变）
    const childRatesUnder11 = [7590, 6325, 5270, 4390, 3660];
    const childRatesOver11 = [10815, 10815, 7210, 7210, 3605];
    const allChildrenSorted = [];
    for (let i = 0; i < kidsOver11; i++) allChildrenSorted.push('over');
    for (let i = 0; i < kidsUnder11; i++) allChildrenSorted.push('under');
    allChildrenSorted.forEach((type, index) => {
        const rank = Math.min(index, 4);
        annualGB += type === 'over' ? childRatesOver11[rank] : childRatesUnder11[rank];
    });
    
    // 新增：标记是否是>4人的大家庭（用于前端判断是否显示租金提示）
    const isLargeFamily = totalPersons > 4;
    const personsForRent = totalPersons >= 4 ? 5 : totalPersons;
    const personKey = getPersonKeyForRent(personsForRent);
    const maxRentMonthly = rentLimits[personKey] || 0;
    const actualRentMonthly = Number(inputs.monthlyRent) || 0;
    const recognizedRentAnnual = Math.min(actualRentMonthly, maxRentMonthly) * 12;
    
    const premiumRef = regionNumber === 2
        ? { adult: 6144, young: 4536, child: 1464 }
        : { adult: 5808, young: 4344, child: 1380 };
    
    // === KK Pauschale 修复（符合 ELG Art. 11 + 州执行细则）===
    // 1. 先计算州标准 Richtprämien（按 Region）
    const standardPremiumAnnual = (numAdults * premiumRef.adult) +
        (kidsOver11 * premiumRef.young) +
        (kidsUnder11 * premiumRef.child);
    
    // 2. 优先使用用户实际输入的年度保费（health_premium / annualHealthPremium）
    let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
    
    // 3. 如果用户未输入（<=0）或数值异常（>30000），才兜底使用州标准
    if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
        totalPremiumAnnual = standardPremiumAnnual;
    }
    
    // 4. 安全上限（兼容其他州代码中的 r.recognized_premiums_annual.max）
    const r = cantonELRules;
    totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);
    
    const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
    
    // --- 收入处理（2026 统一标准） ---
    let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

    const pensionAnnual = Number(inputs.regularAnnualPension || 
                                 inputs.annualPension || 
                                 (inputs.monthlyPensionAmount || 0) * 12 || 0);

    console.log(`[GR] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

    annualIncome += pensionAnnual;

    let deduction13th = 0;
    if (inputs.isReceivingPension === 'ahv') {
        deduction13th = Math.round(pensionAnnual / 12);
        annualIncome = Math.round((annualIncome / 13) * 12);
    }

    // 劳动收入（保留原有）
    const rawEarned = Number(inputs.earnedIncomeAnnual || 0);
    const earnedExemption = isCouple ? 1950 : 1300;
    const countableEarnedIncome = Math.max(0, (rawEarned - earnedExemption) * (2/3));

    // 资产收入（保留原有）
    const kidsCount = kidsUnder11 + kidsOver11;
    const entranceLimit = isCouple ? 200000 : 100000;
    const totalAssets = Number(inputs.taxableAssets || 0);
    if (totalAssets > (entranceLimit + kidsCount * 50000)) {
        return {
            isEligible: false,
            error: 'err_asset_exceeded',
            annualBenefit: 0
        };
    }
    const assetExemption = (isCouple ? 50000 : 30000) + (kidsCount * 15000);
    const divisor = 15;
    const assetIncome = Math.max(0, (totalAssets - assetExemption) / divisor);

    const totalIncome = annualIncome + countableEarnedIncome + assetIncome;
    
    const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
    
    // 修复：使用正确的键名 "application" 而非 "application_info"
    const appData = cantonELRules.application || {};
    
    return {
        annualBenefit: Math.round(annualBenefit),
        monthlyBenefit: Math.round(annualBenefit / 12),
        isEligible: annualBenefit > 0,
        // 新增：把大家庭标记传递给前端
        isLargeFamily: isLargeFamily,
        explanation: {
            steps: [
                { label: 'GR_el_region_' + regionNumber + '_name', value: `Region ${regionNumber}` },
                { label: 'GR_el_grundbedarf_2026', value: Math.round(annualGB) },
                { label: 'GR_el_anerkannte_miete_max', value: Math.round(recognizedRentAnnual) },
                // 已改为官方要求的通用标签，清晰体现“州标准 / 实际保费”
                { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
                { label: 'GR_el_neutralisierung_13_ahv', value: inputs.isReceivingPension === 'ahv' ? 'Ja' : 'Nein' },
                { label: 'GR_el_anrechenbare_einnahmen', value: Math.round(totalIncome) }
            ],
            region: regionNumber,
            note: foundPLZ ? "Basierend auf Ihrer PLZ." : "Standard-Region 3 verwendet.",
            // 新增：添加租金提示文案的key（关联de.json）
            rentLimitHintKey: isLargeFamily ? 'el_rent_limit_hint' : '',
            rentLimitHintTitleKey: isLargeFamily ? 'el_rent_limit_hint_title' : ''
        },
        application: { // 主动提供 GL 风格字段，确保命中 if (rule.application)
            authority_key: appData.authority_key,
            office_key: appData.office_key,
            address_key: appData.address_key,
            phone: appData.phone,
            email: appData.email,
            website: appData.website,
            required_documents_key: appData.docs_key || "GR_el_required_documents_list"
        },
        application_info: appData // 同时保留，兼容其他可能写法
    };
}

function getPersonKeyForRent(personCount) {
    if (personCount === 1) return '1_person';
    if (personCount === 2) return '2_persons';
    if (personCount === 3) return '3_persons';
    return '4_plus_persons'; // 4人及以上统一用这个键（官方规定）
}