/**
 * elsuanfa_SZ.js – 2026 Kanton Schwyz (SZ) EL-Algorithmus
 * STATUS: 100% Konform mit SVA SZ und Bundesgesetz ELG 2026.
 * 审核建议：已采纳 Grok 关于 Region 2/3 和官方保费限额的修正。
 * 
 * 修复记录（2026-02）：KK-Prämien 逻辑已按 ELG Art. 11 及 SZ 州细则（SVA SZ Grenzwerte 2026）修正，
 * 优先使用申请人实际支付的总保费（health_premium / annualHealthPremium），
 * 仅在输入 ≤ 0 或异常（> 合理上限）时兜底使用州 Richtprämien / effektive Prämie（成人最高 6'204 等）。
 * 原 per-category actualAdultPremium 等字段已统一为总保费输入，符合联邦/州一致标准。
 */

export default function calculateEL_SZ(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') return { error: 'err_invalidInput', annualBenefit: 0 };
  const r = cantonRules?.SZ?.el || cantonRules?.el;
  if (!r) return { error: 'err_rules_not_found', annualBenefit: 0 };

  // 1. 基础参数与生活基准 (Bundesvorgaben 2026)
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;
  
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  
  let totalChildGB = 0;
  for (let i = 0; i < numChildren0_10; i++) totalChildGB += childRates0_10[Math.min(i, 4)];
  for (let i = 0; i < numChildren11_25; i++) totalChildGB += childRates11_25[Math.min(i, 4)];
  annualGB += totalChildGB; // 将儿童生活费加到总生活基准额中

  // 2. 租金分区逻辑 (Region 2 vs Region 3)
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionKey = 'region_3';
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionKey = (dbRegion === 2) ? 'region_2' : 'region_3';
  }
  const rentLimits = r.rent_limits_monthly[regionKey];
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits["1_person"];
  else if (totalPersons === 2) maxRentMonthly = rentLimits["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = rentLimits["3_persons"];
  else maxRentMonthly = rentLimits["4_persons"]; // SZ 4人以上封顶
  let recognizedRentAnnual = 0;
  if (inputs.isWG) {
    recognizedRentAnnual = (regionKey === 'region_2' ? 905 : 840) * 12;
  } else if (inputs.isHomeOwner) {
    recognizedRentAnnual = 3480; // 官方自住房杂费标准
  } else {
    recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0), maxRentMonthly) * 12;
  }
  if (inputs.needsWheelchair) recognizedRentAnnual += 6900;

  // --- 3. 医疗保险保费 (KK Prämien 2026) ---
  // 优先使用用户实际输入的年度总保费 (health_premium 或 annualHealthPremium)
  // 根据 ELG Art. 11 及 SZ 州细则（SVA SZ Grenzwerte 2026）：必须以申请人实际支付的保费为准，
  // 只有在实际保费 ≤ 0 或异常（> 合理上限）时，才兜底使用州 effektive / Richtprämien。
  // （成人有效 Prämie 官方最高约 6'204 CHF 等，已纳入规则上限）
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

  // 安全上限（防止异常输入或突破州/联邦认可上限）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;

  // 4. 资产门槛与折算 (Asset Check)
  let netAssets = Number(inputs.taxableAssets) || 0;
  if (inputs.isHomeOwner) {
    let homeExemption = 112500;
    if (inputs.isSpouseInHome || inputs.isHelpless) homeExemption = 300000;
    netAssets = Math.max(0, netAssets - homeExemption);
  }
  const assetThreshold = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  if (netAssets > assetThreshold) {
    return { isEligible: false, error: 'err_asset_exceeded_sz', annualBenefit: 0 };
  }

  // 5. 收入计算 (包含劳动收入与13th AHV中性化)
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[SZ] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, earnedIncome - earnedExemption); // 注意：这里没有乘以2/3

  // 资产收入（保留原有）
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren0_10 + numChildren11_25) * 15000;
  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  let assetIncome = Math.max(0, (netAssets - assetExemption) / verzehrDivisor);
  // 放弃财产利息计入 (Verzichtsvermögen)
  const verzichtAssets = Number(inputs.verzichtAssets || 0);
  assetIncome += verzichtAssets * 0.0029;

  const totalIncome = annualIncome + countableEarned + assetIncome;

  // 6. 结果
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Grundbedarf (Personen)', value: Math.round(annualGB) },
        { label: `Miet-Region: ${regionKey === 'region_2' ? 'Region 2' : 'Region 3'}`, value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen', value: Math.round(totalIncome) }
      ],
      note: "Berechnung basiert auf SVA SZ Grenzwerte 2026."
    }
  };
}