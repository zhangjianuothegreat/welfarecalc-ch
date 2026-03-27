// elsuanfa_AG.js – AG州 EL算法 (2026年版本，已强制使用官方Grundbedarf + 养老金统一处理)
export default function calculateEL_AG(inputs, cantonRules) {
  // 1. 入参安全校验
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput' };

  const numReq = ['numAdults', 'numChildren', 'numEducation', 'taxableIncomeAnnual', 'taxableAssets', 'monthlyRent'];
  for (const f of numReq) {
    if (typeof inputs[f] !== 'number' || inputs[f] < 0 || isNaN(inputs[f])) {
      return { error: `err_negativeOrNaN_${f}`, annualBenefit: 0 };
    }
  }

  // 额外校验：如果领取养老金，必须有金额
  if ((inputs.isReceivingPension === 'ahv' || inputs.isReceivingPension === 'iv') &&
      (typeof inputs.monthlyPensionAmount !== 'number' || inputs.monthlyPensionAmount < 0)) {
    console.warn('缺少或无效的 monthlyPensionAmount，使用 0 计算');
    inputs.monthlyPensionAmount = 0;
  }

  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };

  // 2. 读取规则 (从 el 节点或根节点读取)
  const r = cantonRules?.el || cantonRules || {};

  const assetLimits = r.asset_limits || { single: 100000, couple: 200000 };
  const rentRegions = r.rent_limits_monthly?.regions || [];
  const refPremiums = r.recognized_premiums_annual || { adult: 6852, young_adult: 4980, child: 1608 };
  const deductions = r.income_deductions || { child_deduction_annual: 2500 };

  const isCouple = inputs.numAdults === 2;
  const totalChildren = inputs.numChildren + inputs.numEducation;
  const totalPersons = inputs.numAdults + totalChildren;

  if (totalPersons < 1) return { error: 'err_no_persons', annualBenefit: 0 };

  // 3. 资格检查：资产限额
  const assetLimit = isCouple ? assetLimits.couple : assetLimits.single;
  if (inputs.taxableAssets > assetLimit) {
    return { error: 'err_asset_exceeded', annualBenefit: 0 };
  }

  // 4. 计算基本生活费 (Grundbedarf) – 使用官方2026值 + 儿童阶梯
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  // 退休模式 + 有医疗需求 → 加 300 CHF/月护理额外
  let monthlyBasic = annualGB / 12;
  if (inputs.crowd === 'retired' && inputs.hasMedicalNeeds === 'yes') {
    monthlyBasic += 300;
    console.log('已为退休人员添加 300 CHF/月护理额外需求');
  }

  // 5. 计算认可租金
  const selectedRegion = rentRegions.find(reg => reg.name === (inputs.region || 'region_2')) || rentRegions[0];
  let rentKey = '5_plus_persons';
  if (totalPersons === 1) rentKey = '1_person';
  else if (totalPersons >= 2 && totalPersons <= 4) rentKey = `${totalPersons}_persons`;
  const maxRent = selectedRegion ? (selectedRegion[rentKey] || 0) : 0;
  const recognizedRent = Math.min(inputs.monthlyRent, maxRent);

  // 6. 计算认可保费
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 20000) {
    console.warn(`保费输入异常 (${totalPremiumAnnual} CHF)，使用参考值`);
    totalPremiumAnnual = (inputs.numAdults * refPremiums.adult) +
                         (inputs.numEducation * refPremiums.young_adult) +
                         (inputs.numChildren * refPremiums.child);
  }
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 20000);

  // 7. 总支出 (月)
  const monthlyNeeds = monthlyBasic + recognizedRent + (totalPremiumAnnual / 12);

  // --- 收入处理（2026 统一标准）---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  // 养老金（优先级：regularAnnualPension > annualPension > monthlyPensionAmount）
  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[AG] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  // 第13 AHV-Rente 中性化（仅 AHV）
  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留AG原有）
  const exemption = isCouple ? 200000 : 100000;
  const taxableAssetPart = Math.max(0, inputs.taxableAssets - exemption);
  const divisor = (inputs.pensionType === 'IV') ? 15 : 10;
  const assetIncome = (taxableAssetPart / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;

  // 子女扣除
  const totalChildDeductionMonthly = (totalChildren * deductions.child_deduction_annual) / 12;

  // 月收入计算
  const monthlyAssetIncome = assetIncome / 12;
  const totalMonthlyIncome = Math.max(0, (annualIncome / 12) + monthlyAssetIncome - totalChildDeductionMonthly);

  // 最终结果
  const monthlyBenefit = Math.max(0, monthlyNeeds - totalMonthlyIncome);
  const annualBenefit = Math.round(monthlyBenefit * 12);

  return {
    annualBenefit,
    monthlyBenefit: Math.round(monthlyBenefit),
    explanation: {
      steps: [
        { label: 'step_grundbedarf', value: Math.round(monthlyBasic) },
        { label: 'step_recognized_rent', value: Math.round(recognizedRent) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual / 12) },
        { label: 'step_total_needs_monthly', value: Math.round(monthlyNeeds) },
        { label: 'step_pension_annual_used', value: Math.round(pensionAnnual) },
        { label: 'step_13th_pension_ignored_2026', value: Math.round(deduction13th) },
        { label: 'step_child_deduction_monthly', value: Math.round(totalChildDeductionMonthly) },
        { label: 'step_asset_income_monthly', value: Math.round(monthlyAssetIncome) },
        { label: 'step_available_income_monthly', value: Math.round(totalMonthlyIncome) }
      ],
      note_key: 'AG_el_note_2026_law'
    }
  };
}