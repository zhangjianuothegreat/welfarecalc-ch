/**
 * TG.js – 图尔高州 (TG) 2026 IPV 计算器
 * Basierend auf offiziellen Daten der Gesundheitsdepartement Thurgau 2026
 */

const safeFormatCurrency = (n) => n.toLocaleString('de-CH');

// LNA计算（TG州简单：直接用净收入，无资产加算）
const calculateDeterminingIncome = (inputs) => inputs.netIncomeAnnual || 0;

// 主函数 - ES6 export default
export default function calculateIPV_TG(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: { note: 'ipv_note_no_entitlement_general' }
    };
  }

  const required = ['numAdults', 'numChildren', 'numEducation', 'netIncomeAnnual', 'annualHealthPremium'];
  for (const f of required) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0 || isNaN(inputs[f])) {
      return { annualBenefit: 0, explanation: { note: 'ipv_note_no_entitlement_general' } };
    }
  }

  // 加入资产检查（官方规则：资产 >0 CHF → 无补贴）
  if ((inputs.taxableAssets || 0) > 0) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(calculateDeterminingIncome(inputs)).toLocaleString('de-CH')} CHF` },
          { label: 'Vermögensgrenze', value: '0 CHF' }
        ],
        note: 'ipv_note_no_entitlement_assets'
      }
    };
  }

  const ipv = cantonRules?.TG?.ipv || {};
  const ref = ipv.ref_premium_annual || { adult: 6180, young_adult: 4308, child: 1440 };
  const taxAmounts = ipv.fixed_amounts_by_tax || { tax_400: 3396, tax_600: 2544, tax_800: 1692 };
  const childBonusPerChild = ipv.child_bonus_per_child ?? 850;
  const maxSubsidyRatio = ipv.max_subsidy_ratio ?? 0.8;
  const minPayment = ipv.min_payment ?? 50;
  const maxHouseholdIncome = ipv.income_limits?.max_household_income ?? 80000;

  const lna = calculateDeterminingIncome(inputs);

  // 收入上限检查
  if (lna > maxHouseholdIncome) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
          { label: 'Einkommensgrenze', value: `${maxHouseholdIncome.toLocaleString('de-CH')} CHF` }
        ],
        note: 'ipv_note_no_entitlement_income'
      }
    };
  }

  // 基础补贴根据LNA阶梯
  let baseSubsidyAmount = 0;
  let lnaTierDesc = '';
  if (lna <= 40000) {
    baseSubsidyAmount = taxAmounts.tax_400 || 3396;
    lnaTierDesc = '≤ 40\'000 CHF';
  } else if (lna <= 60000) {
    baseSubsidyAmount = taxAmounts.tax_600 || 2544;
    lnaTierDesc = '40\'001 – 60\'000 CHF';
  } else if (lna <= 80000) {
    baseSubsidyAmount = taxAmounts.tax_800 || 1692;
    lnaTierDesc = '60\'001 – 80\'000 CHF';
  }

  // 孩子/青年奖金
  const childCount = (inputs.numChildren || 0) + (inputs.numEducation || 0);
  const childBonus = childCount * childBonusPerChild;

  // 总参考保费
  const totalRefPremium = (inputs.numAdults || 0) * ref.adult +
                          (inputs.numEducation || 0) * ref.young_adult +
                          (inputs.numChildren || 0) * ref.child;

  // 初步补贴
  let calculatedSubsidy = baseSubsidyAmount + childBonus;

  // 最高补贴限制（参考保费的80%）
  const maxSubsidyLimit = totalRefPremium * maxSubsidyRatio;
  calculatedSubsidy = Math.min(calculatedSubsidy, maxSubsidyLimit);

  // 最低保证
  const minChild = (inputs.numChildren || 0) * ref.child * 0.8;
  const minYoung = (inputs.numEducation || 0) * ref.young_adult * 0.5;
  calculatedSubsidy = Math.max(calculatedSubsidy, minChild + minYoung);

  // 最低发放
  if (calculatedSubsidy < minPayment) calculatedSubsidy = 0;

  // 最终封顶
  const annualBenefit = Math.min(Math.round(calculatedSubsidy), inputs.annualHealthPremium || 0);
  const monthlyBenefit = Math.round(annualBenefit / 12);

  return {
    annualBenefit,
    monthlyBenefit,
    explanation: {
      steps: [
        { label: 'ipv_lna_label', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: 'Grundsubvention (nach LNA)', value: `${Math.round(baseSubsidyAmount).toLocaleString('de-CH')} CHF` },
        { label: 'Kind-/Jugendbonus', value: `${Math.round(childBonus).toLocaleString('de-CH')} CHF` },
        { label: 'ipv_final_ipv', value: `${annualBenefit.toLocaleString('de-CH')} CHF/Jahr` }
      ],
      note: annualBenefit > 0 ? 'ipv_note_eligible_general' : 'ipv_note_no_entitlement_general'
    }
  };
}