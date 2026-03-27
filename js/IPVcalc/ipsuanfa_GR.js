/**
 * Offizieller IPV-Algorithmus Kanton Graubünden (GR) 2026 – Korrigierte Version
 * Rechtsgrundlage: KPVG GR, VOzKPVG GR, KVG-Einführungsgesetz GR + Bundesrichtlinien 2026
 * Typ: Schätzmodell (keine verbindliche Berechnung – SVA GR Rechner maßgeblich)
 * Revision: Anpassung an GR-Praxis 2026 (Selbstbehalt 8–12%, moderate Abzüge, Säule 2/3a abzugsfähig, realistische Kinderentlastung)
 * Wichtig: Endgültige Werte ab Mitte Februar 2026 auf sva.gr.ch verfügbar
 */
export default function calculateIPV_GR(inputs, cantonRules) {
    if (!inputs || typeof inputs !== 'object') return { error: 'Invalid Input', annualBenefit: 0 };
    const r = cantonRules?.ipv;
    if (!r) return { error: 'Rules not found', annualBenefit: 0 };

    // 1. Massgebendes Einkommen (LNA) – GR/Bundes-Standard
    // Säule 2/3a Beiträge sind ABZUGSFÄHIG (nicht +)
    let lna = Math.max(0,
        (inputs.netIncomeAnnual || 0) +
        ((inputs.taxableAssets || 0) * 0.1) +          // 10% Vermögensanteil
        (inputs.nonTaxedParticipationIncome || 0) +
        (inputs.netPropertyIncomeNegative || 0) -      // negative Vermögenserträge abziehen
        (inputs.pillar2Contributions || 0) -           // korrigiert: abzugsfähig
        (inputs.pillar3aContributions || 0) -          // korrigiert: abzugsfähig
        (inputs.charitableDonations || 0) -
        (inputs.politicalPartyContributions || 0) -
        (inputs.alimonyPaid || 0)
    );

    // 2. Kein harter Vermögens-/Einkommens-Cutoff in GR (nur Einfluss auf LNA)

    // 3. Standard-Abzüge (GR moderat, keine extrem hohen Grundabzüge)
    const isCouple = (inputs.numAdults || 1) >= 2;
    const baseDed = isCouple ? r.basic_deduction.couple : r.basic_deduction.single;
    const kidsCount = (inputs.numChildren || 0) + (inputs.numEducation || 0);
    const childDed = kidsCount * r.basic_deduction.per_child;
    const totalDeduction = baseDed + childDed;

    // 4. Überschuss (maßgeblich für Selbstbehalt)
    const excess = Math.max(0, lna - totalDeduction);

    // 5. Gestaffelter Selbstbehaltssatz – GR-Praxis 2026 (8–12%)
    let rate = r.self_retention_rate_max || 0.12;
    const tiers = r.staggered_retention_rates || {};
    if (excess <= 10000) rate = tiers.up_to_10000 || 0.08;
    else if (excess <= 20000) rate = tiers["10001_20000"] || 0.09;
    else if (excess <= 30000) rate = tiers["20001_30000"] || 0.10;
    else if (excess <= 40000) rate = tiers["30001_40000"] || 0.11;

    // 6. Referenzprämien (Richtprämien 2026 – GR kantonal, 3 Regionen)
    let regionKey = inputs.premiumRegion || 'region2'; // PLZ → Region in main.js zuweisen
    if (!['region1','region2','region3'].includes(regionKey)) regionKey = 'region2';
    const ref = r.ref_premium_annual[regionKey] || r.ref_premium_annual.region2 || { adult: 0, young_adult: 0, child: 0 };

    const refAdultTotal   = (inputs.numAdults || 1) * ref.adult;
    const refYoungTotal   = (inputs.numEducation || 0) * ref.young_adult;
    const refChildTotal   = (inputs.numChildren || 0) * ref.child;
    const totalRefPremium = refAdultTotal + refYoungTotal + refChildTotal;

    // 7. Theoretische Subvention
    const selfRetention = excess * rate;
    let theoretical = Math.max(0, totalRefPremium - selfRetention);

    // 8. Kinder-Entlastung (GR hat moderate Reduktion des Kinderanteils am Selbstbehalt)
    let correction = 0;
    if (kidsCount > 0 && lna <= r.child_protection_lna_thresholds.max_considered) {
        let factor = 1.0;
        const thresholds = r.child_protection_lna_thresholds;
        if (lna <= thresholds.full_relief_up_to) factor = 0.0;
        else if (lna <= thresholds.partial_30_up_to) factor = 0.30;
        else if (lna <= thresholds.partial_60_up_to) factor = 0.60;

        const kidsShare = (refYoungTotal + refChildTotal) / totalRefPremium;
        const kidsSelfRetention = selfRetention * kidsShare;
        correction = kidsSelfRetention * (1 - factor);
        theoretical += correction;
    }

    // 9. EL / Sozialhilfe → 100% Deckung
    if (inputs.isELRecipient || inputs.isSocialAssistanceRecipient) {
        theoretical = totalRefPremium;
    }

    // 10. Finalisierung
    let finalBenefit = Math.round(theoretical);
    if (finalBenefit > 0 && finalBenefit < (r.minimum_reduction?.min_subsidy_chf || 100)) {
        finalBenefit = 0;
    }

    // Cap bei tatsächlicher Prämie
    if (inputs.annualHealthPremium) {
        finalBenefit = Math.min(finalBenefit, inputs.annualHealthPremium);
    }

    return {
        annualBenefit: finalBenefit,
        monthlyBenefit: parseFloat((finalBenefit / 12).toFixed(2)),
        explanation: {
            steps: [
                { label: "1. Massgebendes Einkommen (LNA)", value: `${Math.round(lna)} CHF` },
                { label: "2. Abzüge Total (Grund + Kinder)", value: `${Math.round(totalDeduction)} CHF` },
                { label: "3. Überschuss (Excess)", value: `${Math.round(excess)} CHF` },
                { label: "4. Angewandter Selbstbehaltssatz (%)", value: `${(rate * 100).toFixed(1)} %` },
                { label: "5. Referenzprämien Total", value: `${Math.round(totalRefPremium)} CHF` },
                { label: "6. Korrektur für Kinder-Entlastung", value: `${Math.round(correction)} CHF` },
                { label: "7. Finale IPV", value: `${finalBenefit} CHF/Jahr` }
            ]
        },
        metadata: {
            lna: Math.round(lna),
            rate: rate,
            ref: totalRefPremium,
            correction: Math.round(correction)
        },
        error: null
    };
}