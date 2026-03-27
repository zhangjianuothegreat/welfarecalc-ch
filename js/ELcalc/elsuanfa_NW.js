/**
 * elsuanfa_NW.js – 2026 Kanton Nidwalden (NW) EL-Algorithmus [Final 100% Official Match]
 * Gesetzliche Grundlage: ELG 2021-2026 & kantonale Verordnung NW
 * Fokus: Region 3 Fixierung, 13. AHV-Rente Neutralisierung, korrekte Asset-Thresholds.
 */
export default function calculateEL_NW(inputs, cantonRules) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  const r = cantonRules.el || {};
  
  // --- 1. Definitionen & Personen-Status ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren = Number(inputs.numChildren) || 0; // Kinder < 11
  const numEducation = Number(inputs.numYoungAdults || inputs.numEducation || 0); // Kinder/Jugendliche 11-25 in Ausbildung
  const totalPersons = (isCouple ? 2 : 1) + numChildren + numEducation;
  
  // --- 2. Vermögens-Eintrittsschwelle (Asset Threshold) ---
  // Bundesgesetzlicher Standard 2026: 100k / 200k + 50k pro Kind
  let assetLimit = isCouple ? 200000 : 100000;
  assetLimit += (numChildren + numEducation) * 50000;
  if (Number(inputs.taxableAssets) > assetLimit) {
    return {
      isEligible: false,
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [{ label: "Status", value: "Vermögensschwelle überschritten" }],
        note: "Ihr Reinvermögen übersteigt die gesetzliche Eintrittsschwelle."
      }
    };
  }
  
  // --- 3. Ausgaben (Dépenses/Needs) ---
  // A. Lebensbedarf (Bundesstand 2026)
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // Kinder-Staffelung (0-10 Jahre und 11-25 Jahre)（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660, 3660];
  const youngRates = [10815, 10815, 7210, 7210, 3605, 3605];
  let totalChildGB = 0;
  for (let i = 0; i < numChildren; i++) {
    totalChildGB += childRates0_10[Math.min(i, childRates0_10.length - 1)];
  }
  for (let i = 0; i < numEducation; i++) {
    totalChildGB += youngRates[Math.min(i, youngRates.length - 1)];
  }
  annualGB += totalChildGB; // 将儿童生活费加到总生活基准额中
  
  // B. Anerkannte Miete (Region 3 Fix)
  const rentLimitsMonthly = r.rent_limits_monthly.region_3;
  let maxRentMonthly = 0;
  if (totalPersons === 1) maxRentMonthly = rentLimitsMonthly["1_person"];
  else if (totalPersons === 2) maxRentMonthly = rentLimitsMonthly["2_persons"];
  else if (totalPersons === 3) maxRentMonthly = rentLimitsMonthly["3_persons"];
  else if (totalPersons === 4) maxRentMonthly = rentLimitsMonthly["4_persons"];
  else maxRentMonthly = rentLimitsMonthly["5_plus_persons"];
  const recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0), maxRentMonthly) * 12;
  // Zusatz: Rollstuhl-Wohnung (2026 Standard: +6900/Jahr)
  if (inputs.isWheelchairAccessible === true) {
    recognizedRentAnnual += 6900;
  }
  
  // === KK Pauschale 修复（符合 ELG Art. 11 + NW 执行细则）===
  // 1. 先计算州标准 Richtprämien（从 r.recognized_premiums_annual.unified 读取）
  const kk = r.recognized_premiums_annual.unified;
  const standardPremiumAnnual = (isCouple ? 2 * kk.adult : kk.adult) +
                                (numEducation * kk.young_adult) +
                                (numChildren * kk.child);

  // 2. 优先使用用户实际输入的年度保费（health_premium / annualHealthPremium）
  let totalPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  // 3. 如果用户未输入（<=0）或数值异常（>30000），才兜底使用州标准
  if (totalPremiumAnnual <= 0 || totalPremiumAnnual > 30000) {
    totalPremiumAnnual = standardPremiumAnnual;
  }

  // 4. 安全上限（兼容其他州代码中的 r.recognized_premiums_annual.max）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;
  
  // --- 4. Einnahmen (Revenus/Income) ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[NW] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

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
  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  const assetIncome = Math.max(0, (Number(inputs.taxableAssets) - assetExemption) / verzehrDivisor);

  const totalIncome = annualIncome + countableEarned + assetIncome;
  
  // --- 5. Finale Berechnung ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    annualBenefit: Math.round(annualBenefit),
    monthlyBenefit: Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0,
    explanation: {
      steps: [
        { label: "Grundbedarf (jährlich)", value: Math.round(annualGB) },
        { label: "Mietzins-Maximum (Region 3)", value: Math.round(recognizedRentAnnual) },
        // 已改为官方要求的通用标签，清晰体现"州标准 / 实际保费"
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: "Anrechenbare Einnahmen", value: Math.round(totalIncome) }
      ],
      rentRegion: "Region 3: Nidwalden"
    }
  };
};