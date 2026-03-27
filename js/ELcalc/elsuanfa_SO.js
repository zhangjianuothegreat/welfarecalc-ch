/**
 * elsuanfa_SO.js – 2026 Kanton Solothurn (SO) EL-Algorithmus
 * 版本说明：当前为简化家庭版。
 * 收入处理策略：所有收入默认按养老金（Renten）计入，不执行劳动收入的 2/3 折算。
 * 兼容性：包含 2026 联邦 13. AHV 养老金中性化处理。
 * 
 * 修复记录（2026-02）：KK-Prämien 逻辑已按 ELG Art. 11 及 SO 州细则修正，
 * 优先使用申请人实际支付的保费（health_premium / annualHealthPremium），
 * 仅在输入 ≤ 0 或超出合理上限时兜底使用州 Richtprämien。
 */

export default function calculateEL_SO(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  // 1. 安全检查与规则引用修正
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  // 这里的引用增加了容错处理，确保能拿到规则
  const r = cantonRules?.SO?.el || cantonRules?.el;
  if (!r) {
    return { error: 'err_rules_not_found', annualBenefit: 0 };
  }

  // --- 2. 基础支出项 (Dépenses / Ausgaben) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;

  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;

  // 阶梯递减逻辑 (0-10 岁儿童)（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  let totalChildGB = 0;
  for (let i = 0; i < numChildren0_10; i++) {
    totalChildGB += childRates0_10[Math.min(i, 4)];
  }
  // 阶梯递减逻辑 (11-25 岁在教育中的青少年)（保持不变）
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < numChildren11_25; i++) {
    totalChildGB += childRates11_25[Math.min(i, 4)];
  }
  annualGB += totalChildGB; // 将儿童生活费加到总生活基准额中

  // --- 3. 租金计算 (Regionen Solothurn) ---
  const userPLZ = String(inputs.plz || "").trim();
  let regionKey = 'region_3'; // 默认保底 Region 3
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    // 根据邮编匹配 SO 州的分区 (2 或 3)
    regionKey = (allPostalData[userPLZ].EL_REGION === 2) ? 'region_2' : 'region_3';
  }
  const rentLimits = r.rent_limits_monthly[regionKey];
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits["1_person"];
  else if (totalPersons === 2) maxRentMonthly = rentLimits["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = rentLimits["3_persons"];
  else maxRentMonthly = rentLimits["4_persons"]; // 4人及以上使用上限

  let recognizedRentAnnual = 0;
  if (inputs.isWG) {
    // 2026 联邦 WG 统一标准
    recognizedRentAnnual = (regionKey === 'region_2' ? 905 : 840) * 12;
  } else if (inputs.isHomeOwner) {
    // 自住房产暖气及杂费补贴 (Pauschale)
    recognizedRentAnnual = 3480;
  } else {
    // 实际租金与上限取小值
    recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0), maxRentMonthly) * 12;
  }
  // 轮椅附加费
  if (inputs.needsWheelchair) {
    recognizedRentAnnual += 6900;
  }

  // --- 4. 医疗保险保费 (KK Prämien 2026) ---
  // 优先使用用户实际输入的年度保费 (health_premium 或 annualHealthPremium)
  // 根据 ELG Art. 11 及 SO 州细则：必须以申请人实际支付的保费为准，
  // 只有在实际保费 ≤ 0 或异常（> 合理上限）时，才兜底使用州 Richtprämien。
  const actualPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  const p = r.recognized_premiums_annual.unified;

  let totalPremiumAnnual;
  if (actualPremiumAnnual > 0 && actualPremiumAnnual <= (r.recognized_premiums_annual?.max || 30000)) {
    // 使用申请人实际支付的总保费
    totalPremiumAnnual = actualPremiumAnnual;
  } else {
    // 兜底使用州标准 Pauschale
    totalPremiumAnnual = (isCouple ? 2 * p.adult : p.adult)
                         + numChildren11_25 * p.young_adult
                         + numChildren0_10 * p.child;
  }

  // 安全上限（防止异常输入或规则上限被突破）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  // 总支出 (Total Bedarf)
  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;

  // --- 5. 资产与门槛检查 ---
  let netAssets = Number(inputs.taxableAssets || 0);
  // 自住房产免税额扣除
  if (inputs.isHomeOwner) {
    netAssets -= 112500;
    if (isCouple || inputs.isHelpless) netAssets -= 187500;
    netAssets = Math.max(0, netAssets);
  }
  // 准入门槛检查 (联邦 2026: 100k 单身 / 200k 夫妻)
  const assetLimit = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  if (netAssets > assetLimit) {
    return {
      isEligible: false,
      error: 'err_asset_exceeded_so',
      annualBenefit: 0,
      explanation: { note: "Das Reinvermögen übersteigt die Eintrittsschwelle." }
    };
  }

  // --- 6. 收入计算 (按照你的要求统一化) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[SO] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  // B. 劳动收入 (当前家庭版简化为 0，因为已统一在 taxableIncomeAnnual 计入)
  const countableEarned = 0;

  // 资产收入（保留原有）
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren0_10 + numChildren11_25) * 15000;
  // 养老金领取者除以 10，IV 领取者除以 15
  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (netAssets - assetExemption) / divisor);

  // 总收入
  const totalIncome = annualIncome + countableEarned + assetIncome;

  // --- 7. 计算结果 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);

  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Lebensbedarf (inkl. Kinder)', value: Math.round(annualGB) },
        { label: `Anerkannte Wohnkosten (${regionKey.replace('_', ' ')})`, value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen (100% Rentenbasis)', value: Math.round(totalIncome) }
      ],
      note: "Berechnung erfolgt nach AKSO-Richtlinien 2026 (Vereinfachtes Einkommensmodell)."
    }
  };
}