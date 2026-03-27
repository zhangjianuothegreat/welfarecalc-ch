// elsuanfa_NE.js – 2026 Kanton Neuenburg (NE) EL-Algorithmus [Final Corrected Version]
// Gesetzliche Grundlage: LPC & Bundesgesetz über Ergänzungsleistungen (ELG) 2026
// Fokus: Korrekte Region-Differenzierung (2/3) & 13. AHV-Neutralisierung
export default function calculateEL_NE(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  const r = cantonRules.el || {};
  
  // --- 1. Region-Zuweisung via PLZ (Wichtig für NE) ---
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 3; // Default: Region 3
  let foundPLZ = false;
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionNumber = (dbRegion === 2) ? 2 : 3;
    foundPLZ = true;
  }
  const regionKey = `region_${regionNumber}`;
  // NE verwendet region2_medium für Stadt und region3_low für Land
  const premiumKey = (regionNumber === 2) ? "region2_medium" : "region3_low";
  const rentLimits = r.rent_limits_monthly[regionKey];
  const premiumData = r.recognized_premiums_annual[premiumKey];
  
  // --- 2. Personen-Struktur ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren = Number(inputs.numChildren) || 0;
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren + numEducation;
  
  // --- 3. Eintrittsschwelle (Vermögensschwelle 2026) ---
  let assetThreshold = isCouple ? 200000 : 100000;
  assetThreshold += (numChildren + numEducation) * 50000;
  const netAssets = Number(inputs.taxableAssets || 0);
  if (netAssets >= assetThreshold) {
    return {
      isEligible: false,
      error: 'err_asset_exceeded',
      annualBenefit: 0,
      explanation: { note: "Reinvermögen übersteigt Eintrittsschwelle." }
    };
  }
  
  // --- 4. Ausgaben (Bedarf) ---
  // A. Lebensbedarf (Bundesstandard 2026)
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660, 3660];
  const youngRates = [10815, 10815, 7210, 7210, 3605, 3605];
  let totalChildGB = 0;
  for (let i = 0; i < numChildren; i++) totalChildGB += childRates0_10[Math.min(i, childRates0_10.length - 1)];
  for (let i = 0; i < numEducation; i++) totalChildGB += youngRates[Math.min(i, youngRates.length - 1)];
  annualGB += totalChildGB; // 将儿童生活费加到总生活基准额中
  
  // B. Mietzins (Region 2/3)
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimits['1_person'];
  else if (totalPersons === 2) maxRentMonthly = rentLimits['2_persons'];
  else if (totalPersons === 3) maxRentMonthly = rentLimits['3_persons'];
  else maxRentMonthly = rentLimits['4_persons'] || rentLimits['5_plus_persons'];
  let recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0), maxRentMonthly) * 12;
  // Zusatz für Rollstuhl-Wohnung
  if (inputs.isWheelchairAccessible === true) {
    recognizedRentAnnual += 6900;
  }
  
  // === KK Pauschale 修复（符合 ELG Art. 11 + NE 执行细则）===
  // 1. 先计算州标准 Richtprämien（从 premiumData 读取）
  const standardPremiumAnnual = 
    (isCouple ? 2 : 1) * premiumData.adult +
    (numEducation * premiumData.young_adult) +
    (numChildren * premiumData.child);

  // 2. 优先使用用户实际输入的年度保费（health_premium / annualHealthPremium）
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  // 3. 如果用户未输入（<=0）或数值异常（>30000），才兜底使用州标准
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = standardPremiumAnnual;
  }

  // 4. 安全上限（兼容其他州代码中的 r.recognized_premiums_annual.max）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 5. Einnahmen ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[NE] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

  annualIncome += pensionAnnual;

  let deduction13th = 0;
  if (inputs.isReceivingPension === 'ahv') {
    deduction13th = Math.round(pensionAnnual / 12);
    annualIncome = Math.round((annualIncome / 13) * 12);
  }

  // 劳动收入（保留原有）
  const earnedIncome = Number(inputs.earnedIncomeAnnual || 0);
  const earnedExemption = isCouple ? 1950 : 1300;
  const countableEarned = Math.max(0, (earnedIncome - earnedExemption) * (2/3));

  // 资产收入（保留原有）
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren + numEducation) * 15000;
  const divisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (netAssets - assetExemption) / divisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 6. Finaler Check ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: 'Grundbedarf (jährlich)', value: Math.round(annualGB) },
        { label: `Anerkannte Miete (Region ${regionNumber})`, value: Math.round(recognizedRentAnnual) },
        // 已改为官方要求的通用标签，清晰体现"州标准 / 实际保费"
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen', value: Math.round(totalIncome) }
      ],
      note: foundPLZ ? 'Berechnung basiert auf der offiziellen EL-Region.' : 'Standard-Region 3 verwendet.'
    }
  };
}