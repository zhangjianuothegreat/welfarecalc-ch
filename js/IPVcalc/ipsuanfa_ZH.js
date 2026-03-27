/**
 * Offizieller Rechner für die Prämienverbilligung (IPV) Kanton Zürich 2026
 * 修正版：优化了低收入家庭（Geringverdiener）的特殊减免计算。
 */
export default function calculateIPV_ZH(inputs, cantonRules) {
  if (!inputs || typeof inputs !== 'object') return { error: 'Ungültige Eingabedaten', annualBenefit: 0 };
  
  const r = cantonRules?.ZH?.ipv || cantonRules?.ipv;
  if (!r) return { error: 'Regeln nicht gefunden', annualBenefit: 0 };

  // 1. 基础数据准备
  const region = inputs.premiumRegion || 1;
  const refData = r.ref_premiums_annual_70percent[region] || r.ref_premiums_annual_70percent[1];
  const isFamily = inputs.isMarried || (Number(inputs.numChildren) + Number(inputs.numEducation) > 0);
  
  const deductionRate = isFamily ? r.deduction_rate_family : r.deduction_rate_single;
  const assetLimit = isFamily ? r.asset_limit_family : r.asset_limit_single;
  const freibetrag = isFamily ? r.asset_freibetrag_family : r.asset_freibetrag_single;

  // 2. 资产限额检查 (Vermögensprüfung)
  if (Number(inputs.taxableAssets) > assetLimit) {
    return {
      annualBenefit: 0,
      monthlyBenefit: 0,
      explanation: {
        steps: [
          { label: 'Steuerbares Vermögen', value: `${Number(inputs.taxableAssets).toLocaleString('de-CH')} CHF` },
          { label: 'Vermögensgrenze', value: `${assetLimit.toLocaleString('de-CH')} CHF` }
        ],
        note: 'Kein Anspruch: Vermögen übersteigt die kantonale Grenze.'
      }
    };
  }

  // 3. 计算相关收入 (LNA - Massgebendes Einkommen)
  const assetSurplus = Math.max(0, Number(inputs.taxableAssets) - freibetrag);
  const lna = Number(inputs.netIncomeAnnual) + (assetSurplus * r.asset_consumption_rate);

  // 4. 计算参考保费 (Referenzprämien total)
  const refPremium = (Number(inputs.numAdults) * refData.adult) + 
                     (Number(inputs.numEducation) * refData.young) + 
                     (Number(inputs.numChildren) * refData.child);

  // 5. 计算自付额 (Eigenanteil)
  const incomeDeduction = lna * deductionRate;
  const grundbetrag = refPremium * r.grundbetrag_rate;
  
  // 默认自付额是两者取大
  let eigenanteil = Math.max(grundbetrag, incomeDeduction);

  // 6. 核心修正：低收入家庭特殊保护 (Family Special Reduction)
  const hasChildren = (Number(inputs.numChildren) + Number(inputs.numEducation)) > 0;
  const incomeLimit = Number(inputs.numEducation) > 0 ? r.income_limit_with_ausbildung : r.income_limit_no_ausbildung;

  if (hasChildren && lna <= incomeLimit) {
    // 官方逻辑：对于低收入家庭，自付额不应按总额计算，而是拆分计算以保护儿童
    const adultPart = (Number(inputs.numAdults) * refData.adult);
    const youngPart = (Number(inputs.numEducation) * refData.young);
    const childPart = (Number(inputs.numChildren) * refData.child);

    // 成人按比例分摊收入负担，但不少于其参考保费的 30%
    const eigenAdults = Math.max(adultPart * r.grundbetrag_rate, incomeDeduction * (adultPart / refPremium));
    
    // 子女和受教育青年的自付额大幅降低 (官方通常为参考保费的 20%)
    const eigenChildren = childPart * (r.child_eigenanteil_reduction_rate || 0.2);
    const eigenYoung = youngPart * (r.ausbildung_eigenanteil_reduction_rate || 0.2);

    eigenanteil = eigenAdults + eigenChildren + eigenYoung;
  }

  // 7. 最终计算
  // 理论补贴 = 参考保费 - 自付额
  const theoretical = Math.max(0, refPremium - eigenanteil);
  
  // 实际补贴不能超过用户实际缴纳的保费
  const annualBenefit = Math.min(Math.round(theoretical), Number(inputs.annualHealthPremium));

  return {
    annualBenefit,
    monthlyBenefit: Math.round(annualBenefit / 12),
    explanation: {
      steps: [
        { label: 'Massgebendes Einkommen', value: `${Math.round(lna).toLocaleString('de-CH')} CHF` },
        { label: 'Referenzprämien (Basis)', value: `${Math.round(refPremium).toLocaleString('de-CH')} CHF` },
        { label: 'Individueller Eigenanteil', value: `${Math.round(eigenanteil).toLocaleString('de-CH')} CHF` }
      ],
      note: annualBenefit > 0 ? 'Sie haben voraussichtlich Anspruch auf IPV.' : 'Nach offizieller Berechnung besteht kein Anspruch.'
    }
  };
}