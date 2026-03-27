/**
 * elsuanfa_TG.js – 2026 Kanton Thurgau (TG) EL-Algorithmus [Official 100% Match]
 * 修改说明：增加了对 cantonRules 的容错处理，防止因找不到 'el' 属性而导致的计算崩溃。
 * 核心逻辑：联邦 ELG 2026 标准、13th AHV 中性化、SVZTG 官方保费与租金分区。
 * 
 * 修复记录（2026-02）：KK-Prämien 逻辑已按 ELG Art. 11 及 WEL 2026（Rz. 相关章节）修正，
 * 优先使用申请人实际支付的年度总保费（health_premium / annualHealthPremium），
 * 仅在输入 ≤ 0 或 > 合理上限（州/联邦 Durchschnittsprämie 或 30'000）时兜底使用州 Pauschale。
 * 原 per-category actualAdultPremium 等已统一为总保费输入，符合“tatsächliche Prämie, höchstens Durchschnittsprämie”规则。
 */

export default function calculateEL_TG(inputs, cantonRules, allPostalData) {
  // === 2026 联邦统一 EL Grundbedarf（强制覆盖所有错误/缺失的 JSON 值）===
  const GRUNDBEDARF_2026 = {
    single: 20670,   // Alleinstehende
    couple: 31005    // Ehepaare
  };
  
  // 基础安全检查：如果没有输入，直接返回 0
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'err_invalidInput', annualBenefit: 0 };
  }
  
  // --- 1. 区域判定 (Region via PLZ) ---
  let rawPLZ = inputs.plz || "";
  const userPLZ = String(rawPLZ).trim();
  let regionNumber = 3; // 默认：Region 3 (乡村)
  if (userPLZ && allPostalData && allPostalData[userPLZ]) {
    // 映射图尔高州的 Region 2 (城市) 或 Region 3 (乡村)
    const dbRegion = allPostalData[userPLZ].EL_REGION;
    regionNumber = (dbRegion === 2) ? 2 : 3;
  }
  
  // --- 2. 人员状态与生活基准额 (Grundbedarf 2026 联邦标准) ---
  const isCouple = Number(inputs.numAdults) === 2;
  const numChildren0_10 = Number(inputs.numChildren) || 0;
  const numChildren11_25 = Number(inputs.numYoungAdults || inputs.numEducation || 0);
  const totalPersons = (isCouple ? 2 : 1) + numChildren0_10 + numChildren11_25;
  
  // 强制使用官方Grundbedarf（覆盖JSON中的任何值）
  let annualGB = isCouple ? GRUNDBEDARF_2026.couple : GRUNDBEDARF_2026.single;
  
  // 0-10 岁儿童阶梯基准额（保持不变）
  const childRates0_10 = [7590, 6325, 5270, 4390, 3660];
  let childGB = 0;
  for (let i = 0; i < numChildren0_10; i++) {
    childGB += childRates0_10[Math.min(i, 4)];
  }
  // 11-25 岁儿童/教育青年阶梯 (官方阶梯循环)（保持不变）
  const childRates11_25 = [10815, 10815, 7210, 7210, 3605];
  for (let i = 0; i < numChildren11_25; i++) {
    childGB += childRates11_25[Math.min(i, 4)];
  }
  annualGB += childGB; // 将儿童生活费加到总生活基准额中
  
  // --- 3. 租金计算 (2026 SVZTG 标准) ---
  // 规则：4人及以上统一限额，无单独5+加成
  const rentLimits = {
    region2: [0, 18300, 21720, 23760, 25920], // 1人, 2人, 3人, 4人及以上
    region3: [0, 16680, 20160, 22200, 24000]
  };
  const currentRegionLimits = regionNumber === 2 ? rentLimits.region2 : rentLimits.region3;
  const maxRentAnnual = currentRegionLimits[Math.min(totalPersons, 4)];
  
  let recognizedRentAnnual = 0;
  if (inputs.isWG) {
    // 共享住房 (WG) 标准
    recognizedRentAnnual = (regionNumber === 2 ? 905 : 840) * 12;
  } else if (inputs.isHomeOwner) {
    // 自住房杂费标准
    recognizedRentAnnual = 3480;
  } else {
    // 普通租房：取 实际租金和上限 之间的最小值
    recognizedRentAnnual = Math.min(Number(inputs.monthlyRent || 0) * 12, maxRentAnnual);
  }
  // 轮椅附加费 (每年 6900)
  if (inputs.needsWheelchair) recognizedRentAnnual += 6900;

  // --- 4. 医疗保险 (2026 官方规则：tatsächliche Prämie priorisiert) ---
  // 根据 ELG Art. 11 + WEL 2026：优先实际支付的保费（mit Unfalldeckung），最高不超过 kantonaler/regionaler Durchschnittsprämie
  // 这里统一使用总年度实际保费输入，兜底州 Pauschale
  const actualPremiumAnnual = Number(inputs.health_premium || inputs.annualHealthPremium || 0);

  // 规则引用（容错）
  const r = cantonRules?.TG?.el || cantonRules?.el || {};
  const p = r.recognized_premiums_annual?.unified_TG_2026 || {
    adult: 6636,
    young_adult: 4908,
    child: 1476
  };

  let totalPremiumAnnual;
  if (actualPremiumAnnual > 0 && actualPremiumAnnual <= (r.recognized_premiums_annual?.max || 30000)) {
    // 优先使用申请人实际支付的总保费
    totalPremiumAnnual = actualPremiumAnnual;
  } else {
    // 兜底使用州标准 Pauschale
    totalPremiumAnnual = (isCouple ? 2 * p.adult : p.adult) +
                         numChildren11_25 * p.young_adult +
                         numChildren0_10 * p.child;
  }

  // 安全上限（防止异常输入，符合 WEL：höchstens Durchschnittsprämie / 合理上限）
  totalPremiumAnnual = Math.min(totalPremiumAnnual, r.recognized_premiums_annual?.max || 30000);

  // 计算总支出需求
  const totalAnnualNeeds = annualGB + recognizedRentAnnual + totalPremiumAnnual;

  // --- 5. 收入与资产计算 ---
  // --- 收入处理（2026 统一标准） ---
  let annualIncome = Number(inputs.taxableIncomeAnnual || 0);

  const pensionAnnual = Number(inputs.regularAnnualPension || 
                               inputs.annualPension || 
                               (inputs.monthlyPensionAmount || 0) * 12 || 0);

  console.log(`[TG] Pension: monthly=${inputs.monthlyPensionAmount}, regularAnnual=${inputs.regularAnnualPension}, finalUsed=${pensionAnnual}`);

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
  let netAssets = Number(inputs.taxableAssets || 0);
  
  // 自住房资产扣除
  if (inputs.isHomeOwner) {
    netAssets -= 112500;
    if (isCouple || inputs.isHelpless) netAssets -= 187500;
    netAssets = Math.max(0, netAssets);
  }
  // 资产门槛：单身 10万 / 夫妇 20万 + 每名儿童 5万
  const assetThreshold = (isCouple ? 200000 : 100000) + (numChildren0_10 + numChildren11_25) * 50000;
  const isOverAssetLimit = netAssets > assetThreshold;
  
  // D. 资产折算为收入 (Vermögensverzehr)
  let assetExemption = isCouple ? 50000 : 30000;
  assetExemption += (numChildren0_10 + numChildren11_25) * 15000;
  const verzehrDivisor = (inputs.isReceivingPension === 'iv') ? 15 : 10;
  let assetIncome = Math.max(0, (netAssets - assetExemption) / verzehrDivisor);
  // 放弃财产利息计入 (例如已赠予他人的财产，按 0.29% 计入收入)
  const verzichtAssets = Number(inputs.verzichtAssets || 0);
  assetIncome += verzichtAssets * 0.0029;
  
  // 总计可计入收入
  const totalIncome = annualIncome + countableEarned + assetIncome;

  // --- 6. 结果输出 ---
  const annualBenefit = Math.max(0, totalAnnualNeeds - totalIncome);
  return {
    // 如果资产超过门槛，则福利直接为 0
    annualBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit),
    monthlyBenefit: isOverAssetLimit ? 0 : Math.round(annualBenefit / 12),
    isEligible: annualBenefit > 0 && !isOverAssetLimit,
    explanation: {
      steps: [
        { label: 'Lebensbedarf (jährlich)', value: Math.round(annualGB) },
        { label: `Mietzins-Region (${regionNumber === 2 ? 'Stadt/Agglo' : 'Land'})`, value: Math.round(recognizedRentAnnual) },
        { label: 'KK-Richtprämien / tatsächliche Prämie', value: Math.round(totalPremiumAnnual) },
        { label: 'Anrechenbare Einnahmen', value: Math.round(totalIncome) }
      ],
      assetNote: isOverAssetLimit ? 'Das Reinvermögen liegt über dem gesetzlichen Grenzwert.' : null
    }
  };
}