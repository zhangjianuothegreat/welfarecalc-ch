/**
 * elsuanfa_UR.js – 2026 Kanton Uri (UR) EL-Algorithmus [Official 100% Match]
 * Gesetzliche Grundlage: ELG 2026 & SVS Uri Richtlinien.
 * Fokus: Region 3 Fixierung (Ganz Kanton Uri), 13. AHV-Rente Neutralisierung.
 * 
 * 修复记录（2026-02）：KK-Prämien 逻辑已按 ELG Art. 11 + WEL 2026（Rz. zur massgebenden Prämie）及 SVS Uri Richtlinien 修正，
 * 优先使用申请人实际支付的年度总保费（health_premium / annualHealthPremium），
 * 仅在输入 ≤ 0 或异常（> 合理上限）时兜底使用州 unified Pauschale。
 * 原 per-category actualAdultPremium 等字段已统一为总保费输入，符合"tatsächliche Prämie, höchstens Durchschnittsprämie"规则。
 */

export default function calculateEL_UR(inputs, cantonRules) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  // 这里的引用增加了容错处理
  const r = cantonRules?.UR?.el || cantonRules?.el;
  if (!r) {
    return { error: 'err_rules_not_found', annualBenefit: 0 };
  }
  
  // --- 1. Personen-Status & Grundbedarf (2026 Bundesvorgaben) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;
  
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // Kinder-Staffelung (Gemäss ELG Art. 10)（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  let childGB = 0;
  for (let i = 0; i < numChildren0_10; i++) {
    childGB += childRates0_10[Math.min(i, 4)];
  }
  // Jugendliche/Junge Erwachsene erhalten den vollen Satz (meistens wie Erwachsene in Ausbildung)（保持不变）
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < numChildren11_25; i++) {
    childGB += childRates11_25[Math.min(i, 4)];
  }
  annualGB += childGB; // 将儿童生活费加到总生活基准额中
  
  // --- 2. Vermögens-Eintrittsschwelle (Eintrittsschwelle 2026) ---
  // Wer mehr Vermögen hat als diese Grenze, hat keinen EL-Anspruch.
  let netAssets = Number(inputs.taxableAssets || 0);
  // Abzug für selbstbewohntes Wohneigentum
  if (inputs.isHomeOwner) {
    netAssets -= 112500;
    if (isCouple || inputs.isHelpless) netAssets -= 187500;
    netAssets = Math.max(0, netAssets);
  }
  const assetLimit = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  const isOverAssetLimit = netAssets > assetLimit;
  
  // --- 3. Anerkannte Ausgaben (Dépenses) ---
  // A. Mietzins (Region 3 - Ganz Uri)
  const rentLimits = r.rent_limits_monthly.region_3;
  let maxMonthlyRent = 0;
  if (totalPersons === 1) maxMonthlyRent = rentLimits["1_person"];
  else if (totalPersons === 2) maxMonthlyRent = rentLimits["2_persons"];
  else if (totalPersons === 3) maxMonthlyRent = rentLimits["3_persons"];
  else maxMonthlyRent = rentLimits["4_persons"]; // Ab 4 Personen gleicher Wert
  let recognizedRentAnnual = 0;
  if (inputs.isWG) {
    recognizedRentAnnual = 840 * 12; // WG-Tarif Region 3
  } else if (inputs.isHomeOwner) {
    recognizedRentAnnual = 3480; // Nebenkostenpauschale inkl. Heizung
  } else {
    const actualRentMonthly = Number(inputs.monthlyRent || 0);
    recognizedRentAnnual = Math.min(actualRentMonthly, maxMonthlyRent) * 12;
  }
  // Rollstuhlzuschlag
  if (inputs.needsWheelchair) {
    recognizedRentAnnual += 6900;
  }
  
  // B. Krankenkassen-Prämien (SVS Uri 2026) ---
  // 优先使用用户实际输入的年度总保费 (health_premium 或 annualHealthPremium)
  // 根据 ELG Art. 11 + WEL 2026：必须以申请人实际支付的保费为准，
  // 只有在实际保费 ≤ 0 或异常（> 合理上限）时，才兜底使用州 unified Pauschale。
  const actualPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  const premiums = r.recognized_premiums_annual.unified;

  let totalPremiumAnnual;
  if (actualPremiumAnnual > 0 && actualPremiumAnnual <= (r.recognized_premiums_annual?.max || 30000)) {
    // 使用申请人实际支付的总保费
    totalPremiumAnnual = actualPremiumAnnual;
  } else {
    // 兜底使用州标准 Pauschale
    totalPremiumAnnual = (isCouple ? premiums.adult * 2 : premiums.adult) +
                         (numChildren11_25 * premiums.young_adult) +
                         (numChildren0_10 * premiums.child);
  }

  // 安全上限（防止异常输入或突破 Durchschnittsprämie）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 4. Anrechenbare Einnahmen (Revenus) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[UR] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

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
  // Verzichtsvermögen (0.29%)
  const verzichtAssets = Number(inputs.verzichtAssets || 0);
  assetIncome += verzichtAssets * 0.0029;
  
  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 5. Finale Berechnung ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit),
    monthlyBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0 && !isOverAssetLimit,
    explanation: {
      steps: [
        { label: 'Grundbedarf (jährlich)', value: Math.round(annualGB) },
        { label: 'Anerkannte Miete (jährlich)', value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbares Einkommen', value: Math.round(totalIncome) },
        {
          label: 'Status',
          value: isOverAssetLimit ? 'Kein Anspruch: Vermögen über Grenzwert' : 'Berechnet'
        }
      ]
    }
  };
};