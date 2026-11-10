<?php
/**
 * MeteoFoux - Logique météo
 *
 * Tout le calcul déterministe du proxy : fusion multi-modèles, classification
 * neige/pluie (Roebber SLR), correction d'inversion thermique, résolution des
 * icônes MET.no, agrégation 6h, merge de l'historique MET.no.
 *
 * Aucune I/O, aucune dépendance à $_GET ni au réseau : ce fichier est chargeable
 * seul, donc testable (voir tests/weather-test.php).
 */

// ================= CONSTANTES MÉTÉO =================


// Seuil de détection neige, sur la température humide (wet-bulb) : elle tient compte
// du refroidissement par évaporation, et vaut T en air saturé
const SNOW_WET_BULB_THRESHOLD = 1.0;   // °C - Neige si température humide <= cette valeur

// Seuils qualité de neige (sèche vs humide)
const DRY_SNOW_TEMP_THRESHOLD = -2;       // °C - Neige sèche si temp <= cette valeur
const DRY_SNOW_DEW_POINT_THRESHOLD = -3;  // °C - OU dew_point <= cette valeur

// Méthode Roebber (Snow-to-Liquid Ratio)
const ROEBBER_BASE_SLR = 14.0;        // Ratio de base alpin (observations ~14-15:1)
const ROEBBER_TEMP_THRESHOLD_K = 271.16; // -2°C en Kelvin (pivot chaud/froid)
const ROEBBER_HUMIDITY_REF = 75;       // % - Humidité de référence (neutre)
const ROEBBER_WIND_THRESHOLD = 3;      // m/s - Seuil de compaction par le vent
const SLR_MIN = 5.0;                   // Borne basse réaliste
const SLR_MAX = 25.0;                  // Borne haute réaliste

// Seuils d'intensité des précipitations (pour icônes)
const SNOW_LIGHT_THRESHOLD = 1.0;      // cm - en dessous = neige légère
const SNOW_HEAVY_THRESHOLD = 2.5;      // cm - au dessus = neige forte
const RAIN_LIGHT_THRESHOLD = 2.5;      // mm - en dessous = pluie légère
const RAIN_HEAVY_THRESHOLD = 7.5;      // mm - au dessus = pluie forte
const SLEET_LIGHT_THRESHOLD = 1.0;     // mm - en dessous = neige fondue légère
const SLEET_HEAVY_THRESHOLD = 2.5;     // mm - au dessus = neige fondue forte

// ================= CALCULS =================

/**
 * Récupère une valeur depuis les données multi-modèles avec fallback
 * Parcourt les modèles par ordre de priorité jusqu'à trouver une valeur non-null
 */
function get_model_value($data, $key, $index, $models_priority) {
    foreach ($models_priority as $model) {
        $k = $key . '_' . $model;
        if (isset($data[$k][$index]) && $data[$k][$index] !== null) {
            return $data[$k][$index];
        }
    }
    return $data[$key][$index] ?? null;
}

/**
 * Le modèle qui fournit la valeur que get_model_value() retient : le premier de la chaîne
 * qui n'est pas null. null si aucun modèle de la chaîne n'en a (repli non suffixé compris).
 * Sert à dire au front quel modèle a vraiment servi (la chaîne "AROME" passe à ARPEGE vers J+2).
 */
function get_model_source($data, $key, $index, $models_priority) {
    foreach ($models_priority as $model) {
        if (isset($data[$key . '_' . $model][$index]) && $data[$key . '_' . $model][$index] !== null) {
            return $model;
        }
    }
    return null;
}

/**
 * Le modèle que best_match recopie à cette heure : 'icon_d2' ou 'best_match'.
 * Open-Meteo ne dit pas quel modèle il prend. À La Foux, best_match est une copie exacte
 * d'ICON-D2 (DWD, 2 km) sur ses ~33 premières heures, puis s'en écarte (constat du 10/11/2026,
 * 4 points, 22 modèles comparés). On ne le nomme que sur une copie exacte : température, point
 * de rosée, précipitation et vent identiques. Sans icon_d2 dans la réponse : 'best_match'.
 */
function best_match_model($hourly, $index) {
    foreach (['temperature_2m', 'dew_point_2m', 'precipitation', 'wind_speed_10m'] as $key) {
        $best = $hourly[$key . '_best_match'][$index] ?? null;
        $d2 = $hourly[$key . '_icon_d2'][$index] ?? null;
        if ($best === null || $d2 === null || (float) $best !== (float) $d2) {
            return 'best_match';
        }
    }
    return 'icon_d2';
}

/**
 * Détermine si les précipitations tombent sous forme de neige
 * Critère : température humide <= SNOW_WET_BULB_THRESHOLD.
 *
 * Un double seuil sur T et Td ne fonctionne pas : pendant les précipitations l'air est
 * saturé (T == Td), et "T <= 1.5 ET Td <= 0.5" revenait alors à "T <= 0.5".
 * La température humide reste juste en air saturé, et capte la neige par évaporation
 * en air sec au-dessus de 0°C.
 *
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C (null : air supposé saturé)
 * @return bool True si les conditions indiquent de la neige
 */
function is_snow_conditions($temp, $dew_point) {
    if ($temp === null) return false;
    $wet_bulb = $dew_point === null ? $temp : calculate_wet_bulb($temp, $dew_point);
    return $wet_bulb <= SNOW_WET_BULB_THRESHOLD;
}

/**
 * Détermine la qualité de la neige (sèche ou humide)
 * Basé sur température et point de rosée
 * 
 * @param float $snowfall Quantité de neige
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C
 * @return string|null 'dry', 'wet', ou null si pas de neige
 */
function get_snow_quality($snowfall, $temp, $dew_point) {
    if ($snowfall <= 0 || $temp === null || $dew_point === null) {
        return null;
    }
    
    // Neige humide/collante si temp > seuil ET point de rosée > seuil
    $is_sticky = ($temp > DRY_SNOW_TEMP_THRESHOLD && $dew_point > DRY_SNOW_DEW_POINT_THRESHOLD);
    
    return $is_sticky ? 'wet' : 'dry';
}

/**
 * Calcule le ratio neige/eau (Snow-to-Liquid Ratio) selon la méthode Roebber simplifiée
 *
 * Basé sur Roebber et al. (2003) - adapté pour les Alpes européennes
 * Prend en compte : température, humidité relative, vitesse du vent (compaction)
 *
 * Observations alpines : densité neige fraîche ~68-110 kg/m³ (SLR moyen ~14-15:1)
 * Source: https://hess.copernicus.org/articles/22/2655/2018/
 *
 * @param float|null $temp Température en °C
 * @param float|null $humidity Humidité relative en %
 * @param float|null $wind_speed Vitesse du vent en m/s
 * @return float Ratio SLR (ex: 15 signifie 1mm eau = 1.5cm neige)
 */
function calculate_roebber_slr($temp, $humidity = null, $wind_speed = null) {
    $base_slr = ROEBBER_BASE_SLR;
    $threshold_k = ROEBBER_TEMP_THRESHOLD_K;

    if ($temp === null) {
        return $base_slr;
    }

    // Ajustement température (similaire à Kuchera)
    $temp_k = $temp + 273.15;
    if ($temp_k > $threshold_k) {
        // Au-dessus de -2°C : pente plus forte (fonte possible)
        $temp_adj = 2.0 * ($threshold_k - $temp_k);
    } else {
        // En dessous de -2°C : neige plus légère
        $temp_adj = ($threshold_k - $temp_k);
    }

    // Ajustement humidité (Roebber factor)
    // Humidité haute (>90%) = neige plus humide/dense = SLR plus bas
    $humidity = $humidity ?? ROEBBER_HUMIDITY_REF;
    $humid_adj = (ROEBBER_HUMIDITY_REF - $humidity) / 15;  // ~[-1, +1]

    // Ajustement vent - compaction (Roebber factor)
    $wind_speed = $wind_speed ?? 0;
    $wind_adj = -max(0, ($wind_speed - ROEBBER_WIND_THRESHOLD)) * 0.3;  // Pénalité progressive

    $slr = $base_slr + $temp_adj + $humid_adj + $wind_adj;

    // Borner entre valeurs réalistes observées
    return max(SLR_MIN, min($slr, SLR_MAX));
}

/**
 * Calcule le snowfall en utilisant le ratio SLR
 *
 * @param float $precipitation Précipitation en mm
 * @param float $slr Ratio Snow-to-Liquid
 * @return float Neige en cm
 */
function calculate_snowfall_from_slr($precipitation, $slr) {
    // precipitation (mm) * SLR / 10 = neige en cm
    // Ex: 10mm * 15 / 10 = 15cm
    return $precipitation * $slr / 10.0;
}

/**
 * Classifie les précipitations en neige/pluie et calcule les quantités via Roebber SLR
 *
 * Logique commune utilisée par Open-Meteo et MET.no :
 * 1. Détecte si les conditions sont neigeuses (temp + dew_point)
 * 2. Calcule le SLR Roebber (temp, humidité, vent)
 * 3. Convertit la précipitation en cm de neige ou mm de pluie
 * 4. Détermine la qualité de neige (sèche/humide)
 *
 * @param float $precip Précipitation totale en mm
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C
 * @param float|null $humidity Humidité relative en %
 * @param float|null $wind_speed Vitesse du vent en m/s
 * @return array ['snowfall' => float, 'rain' => float, 'snow_quality' => string|null, 'roebber_slr' => float, 'snowfall_roebber' => float]
 */
function classify_precipitation($precip, $temp, $dew_point, $humidity = null, $wind_speed = null) {
    $roebber_slr = calculate_roebber_slr($temp, $humidity, $wind_speed);

    if ($precip <= 0) {
        return [
            'snowfall' => 0,
            'rain' => 0,
            'snow_quality' => null,
            'roebber_slr' => $roebber_slr,
            'snowfall_roebber' => 0
        ];
    }

    $is_snow = is_snow_conditions($temp, $dew_point);
    $snowfall_roebber = $is_snow ? round(calculate_snowfall_from_slr($precip, $roebber_slr), 2) : 0;

    return [
        'snowfall' => $is_snow ? $precip : 0,
        'rain' => $is_snow ? 0 : $precip,
        'snow_quality' => $is_snow ? get_snow_quality($snowfall_roebber, $temp, $dew_point) : null,
        'roebber_slr' => $roebber_slr,
        'snowfall_roebber' => $snowfall_roebber
    ];
}

/**
 * Calcule le point de rosée à partir de la température et de l'humidité relative
 * Formule de Magnus-Tetens (précision ±0.4°C pour -40°C à 50°C)
 * 
 * @param float|null $temp Température en °C
 * @param float|null $humidity Humidité relative en %
 * @return float|null Point de rosée en °C
 */
function calculate_dew_point($temp, $humidity) {
    if ($temp === null || $humidity === null || $humidity <= 0) {
        return null;
    }
    
    $a = 17.27;
    $b = 237.7;
    $alpha = (($a * $temp) / ($b + $temp)) + log($humidity / 100);
    
    return round(($b * $alpha) / ($a - $alpha), 1);
}

/**
 * Calcule la température humide (wet-bulb) à partir de la température et du point de rosée
 * Formule de Stull (2011), l'humidité relative étant déduite de T et Td par Magnus-Tetens.
 * Écart mesuré face au calcul psychrométrique exact à 750 hPa (~2500 m) : -0.4 à 0°C,
 * biais moyen -0.2°C. Bornée entre Td et T, comme l'impose la physique.
 *
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C
 * @return float|null Température humide en °C
 */
function calculate_wet_bulb($temp, $dew_point) {
    if ($temp === null || $dew_point === null) {
        return null;
    }
    if ($dew_point >= $temp) {
        return round($temp, 1);  // Air saturé
    }

    $a = 17.27;
    $b = 237.7;
    $rh = 100 * exp(($a * $dew_point) / ($b + $dew_point) - ($a * $temp) / ($b + $temp));

    $wet_bulb = $temp * atan(0.151977 * sqrt($rh + 8.313659))
        + atan($temp + $rh) - atan($rh - 1.676331)
        + 0.00391838 * pow($rh, 1.5) * atan(0.023101 * $rh)
        - 4.686035;

    return round(max($dew_point, min($temp, $wet_bulb)), 1);
}

/**
 * Corrige le freezing_level en cas d'incohérence avec la température locale
 *
 * Problème : Les modèles météo calculent le freezing_level à partir du profil
 * atmosphérique "libre", sans tenir compte des inversions thermiques locales
 * fréquentes en montagne (air froid piégé dans les vallées).
 *
 * Résultat : Quand la température à la station est négative, le freezing_level
 * indique parfois une altitude bien supérieure, ce qui est incohérent.
 *
 * Solution :
 * 1. Si best_match est cohérent (freezing_level <= elevation OU temp > 0°C) → utiliser best_match
 *    SAUF si temp très négative et freezing proche de l'élévation (bug best_match probable)
 * 2. Sinon, utiliser meteoswiss_icon_seamless comme fallback (plus fiable en montagne)
 * 3. Si meteoswiss aussi incohérent → retourner l'elevation avec flag "corrected"
 *
 * @param float|null $freezing_level Altitude de l'isotherme 0°C best_match (en m)
 * @param float|null $freezing_level_fallback Altitude MeteoSwiss (en m)
 * @param float|null $temp Température à la station (en °C)
 * @param float $elevation Altitude de la station (en m, depuis Open-Meteo)
 * @return array ['value' => float|null, 'corrected' => bool, 'source' => string]
 */
function correct_freezing_level($freezing_level, $freezing_level_fallback, $temp, $elevation) {
    // Pas de données
    if ($elevation === null) {
        return ['value' => $freezing_level !== null ? round($freezing_level) : null, 'corrected' => false, 'source' => 'best_match'];
    }

    // Détection de valeur suspecte : temp très négative mais freezing proche de l'élévation
    // Avec -10°C, l'iso 0 devrait être ~1500m plus bas (gradient ~6.5°C/1000m)
    // Si freezing est dans les 500m sous l'élévation avec temp < -5°C, c'est suspect
    $suspect_best_match = ($temp !== null && $temp < -5 && $freezing_level !== null
        && $freezing_level > $elevation - 500);

    // Cas cohérent avec best_match : freezing_level <= elevation OU temp > 0°C
    // Mais pas si la valeur semble suspecte
    if (!$suspect_best_match && $freezing_level !== null && ($freezing_level <= $elevation || $temp === null || $temp > 0)) {
        return ['value' => round($freezing_level), 'corrected' => false, 'source' => 'best_match'];
    }

    // best_match incohérent ou suspect → essayer meteoswiss_icon_seamless
    if ($freezing_level_fallback !== null) {
        // MeteoSwiss cohérent ?
        if ($freezing_level_fallback <= $elevation || $temp === null || $temp > 0) {
            return ['value' => round($freezing_level_fallback), 'corrected' => false, 'source' => 'meteoswiss'];
        }
    }

    // Aucun modèle cohérent : freezing_level > elevation ET temp <= 0°C
    // On indique que le vrai freezing_level est sous l'altitude de la station
    return ['value' => round($elevation), 'corrected' => true, 'source' => 'elevation'];
}

/**
 * Résout l'icône MET.no pour un type de précipitation donné.
 *
 * Centralise la logique thunder/showers/fallback nuit en un seul endroit.
 * Chaque type a un mapping avec les noms d'icônes MET.no correspondants.
 *
 * Note: MET.no a des typos dans leurs noms de fichiers :
 * - lightssleetshowersandthunder (double 's' après "light")
 * - lightssnowshowersandthunder (double 's' après "light")
 *
 * @param string $type Type de précipitation (ex: 'heavysnow', 'lightsleet')
 * @param bool $showers WMO indique des averses
 * @param bool $thunder WMO indique un orage
 * @param bool $is_day Jour ou nuit
 * @param string $suffix '_day' ou '_night'
 * @return string Symbol code MET.no
 */
function resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix) {
    // Mapping : type → [showersandthunder, andthunder, showers, base, night_fallback]
    // night_fallback : true = utilise "showers" + suffix la nuit (Variants=0 sans _night)
    //                  false = pas de fallback (Variants=0, icône fixe jour/nuit)
    $icons = [
        'heavysleet'  => ['heavysleetshowersandthunder',  'heavysleetandthunder',  'heavysleetshowers',  'heavysleet',  true],
        'sleet'       => ['sleetshowersandthunder',        'sleetandthunder',       'sleetshowers',       'sleet',       true],
        'lightsleet'  => ['lightssleetshowersandthunder',  'lightsleetandthunder',  'lightsleetshowers',  'lightsleet',  true],
        'heavysnow'   => ['heavysnowshowersandthunder',    'heavysnowandthunder',   'heavysnowshowers',   'heavysnow',   false],
        'snow'        => ['snowshowersandthunder',         'snowandthunder',        'snowshowers',        'snow',        true],
        'lightsnow'   => ['lightssnowshowersandthunder',   'lightsnowandthunder',   'lightsnowshowers',   'lightsnow',   true],
        'heavyrain'   => ['heavyrainshowersandthunder',    'heavyrainandthunder',   'heavyrainshowers',   'heavyrain',   false],
        'rain'        => ['rainshowersandthunder',         'rainandthunder',        'rainshowers',        'rain',        false],
        'lightrain'   => ['lightrainshowersandthunder',    'lightrainandthunder',   'lightrainshowers',   'lightrain',   false],
    ];

    [$sat, $at, $sh, $base, $night_fb] = $icons[$type];

    if ($thunder) return $showers ? $sat : $at;
    if ($showers) return $sh . $suffix;
    if (!$is_day && $night_fb) return $sh . $suffix;
    return $base;
}

/**
 * Détermine le symbol_code MET.no basé sur les précipitations et le code WMO
 *
 * Référence : legend.csv de MET.no
 * - Variants=1 : icônes avec _day/_night (clearsky, fair, partlycloudy, *showers*)
 * - Variants=0 : icônes uniques (cloudy, fog, rain, snow, sleet sans "showers")
 *
 * Codes WMO :
 * - 0: ciel clair, 1: peu nuageux, 2: partiellement nuageux, 3: couvert
 * - 45,48: brouillard
 * - 51-57: bruine (56-57 verglaçante)
 * - 61-67: pluie (66-67 verglaçante)
 * - 68-69: pluie et neige mêlées
 * - 71-77: neige
 * - 80-82: averses de pluie
 * - 85-86: averses de neige
 * - 95,96,99: orage
 *
 * @param bool|null $showers Averses, si la source le dit (MET.no) ; null : déduit du code WMO
 * @param bool|null $thunder Orage, si la source le dit (MET.no) ; null : déduit du code WMO
 */
function determine_symbol($snowfall, $rain, $wmo_code, $is_day, $showers = null, $thunder = null) {
    $wmo_code = $wmo_code ?? 0;
    $suffix = $is_day ? '_day' : '_night';
    $showers = $showers ?? in_array($wmo_code, [80, 81, 82, 85, 86], true);
    $thunder = $thunder ?? in_array($wmo_code, [95, 96, 99], true);

    // Déterminer le type de précipitation, puis déléguer à resolve_precip_icon

    // Sleet par code WMO (bruine/pluie verglaçante, pluie et neige mêlées)
    if (in_array($wmo_code, [56, 57, 66, 67, 68, 69], true)) {
        $type = in_array($wmo_code, [57, 67, 69]) ? 'heavysleet' : 'lightsleet';
        return resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix);
    }

    // Sleet par les données : pluie ET neige en même temps
    if ($rain > 0 && $snowfall > 0) {
        $total = $rain + $snowfall;
        $type = $total >= SLEET_HEAVY_THRESHOLD ? 'heavysleet'
              : ($total >= SLEET_LIGHT_THRESHOLD ? 'sleet' : 'lightsleet');
        return resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix);
    }

    // Neige
    if ($snowfall > 0) {
        $type = $snowfall >= SNOW_HEAVY_THRESHOLD ? 'heavysnow'
              : ($snowfall >= SNOW_LIGHT_THRESHOLD ? 'snow' : 'lightsnow');
        return resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix);
    }

    // Pluie
    if ($rain > 0) {
        $type = $rain >= RAIN_HEAVY_THRESHOLD ? 'heavyrain'
              : ($rain >= RAIN_LIGHT_THRESHOLD ? 'rain' : 'lightrain');
        return resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix);
    }

    // Pas de précipitation détectée → fallback WMO
    // Codes WMO fixes (Variants=0, pas de jour/nuit)
    $wmo_fixed = [
        51 => 'lightrain', 53 => 'lightrain', 55 => 'lightrain',
        61 => 'lightrain', 63 => 'lightrain', 80 => 'lightrain',
        65 => 'rain', 81 => 'rain', 82 => 'rain',
        95 => 'rainandthunder', 96 => 'rainandthunder', 99 => 'rainandthunder',
        75 => 'heavysnow', 77 => 'heavysnow', 86 => 'heavysnow',
    ];
    if (isset($wmo_fixed[$wmo_code])) return $wmo_fixed[$wmo_code];

    // Codes WMO avec fallback nuit (Variants=0, on utilise showers_night)
    // Note: codes 56-69 sont déjà traités par la branche sleet WMO ci-dessus
    $wmo_night_fb = [
        71 => 'lightsnow', 85 => 'lightsnow',
        73 => 'snow',
    ];
    if (isset($wmo_night_fb[$wmo_code])) {
        return resolve_precip_icon($wmo_night_fb[$wmo_code], false, false, $is_day, $suffix);
    }

    // Nuages/soleil/brouillard
    return match ($wmo_code) {
        0 => 'clearsky' . $suffix,      // Ciel clair
        1 => 'fair' . $suffix,          // Peu nuageux
        2 => 'partlycloudy' . $suffix,  // Partiellement nuageux
        3 => 'cloudy',                  // Couvert (Variants=0)
        45, 48 => 'fog',                // Brouillard (Variants=0)
        default => 'clearsky' . $suffix
    };
}

// ================= ADAPTATEURS : une source → lignes horaires communes =================
//
// Chaque source est convertie en lignes horaires au même format, puis passe par le même
// pipeline (derive_hourly). Une ligne contient :
//   time (UTC, 'AAAA-MM-JJTHH:MM'), temperature, apparent_temperature, dew_point, humidity,
//   wind_speed et wind_gusts (m/s, non arrondis), wind_direction, precipitation (mm),
//   precipitation_probability, freezing_point, freezing_point_corrected, cloud_cover,
//   weather_code, symbol_code (icône fournie par la source, sinon null), showers et thunder
//   (averses / orage selon la source, null : déduits de weather_code), uv_index, is_day
// Les corrections propres à une source restent dans son adaptateur.

/**
 * Open-Meteo → lignes horaires communes, pour une chaîne de priorités de modèles
 * (best_match par défaut, ou arome_priorities()).
 *
 * Corrections propres à Open-Meteo : incohérence weather_code / précipitations (best_match
 * mélange les modèles), weather_code / couverture nuageuse, isotherme 0 en cas d'inversion,
 * replis UV et is_day.
 *
 * @param array $openmeteo Données brutes Open-Meteo
 * @param float|null $elevation Altitude du point (depuis Open-Meteo)
 * @param array|null $priorities Priorités personnalisées ['hd' => [...], 'decomp' => [...], 'prob' => [...], 'freezing' => [...], 'cloud' => [...]]
 * @return array Lignes horaires communes
 */
function openmeteo_rows($openmeteo, $elevation = null, $priorities = null) {
    $hourly = $openmeteo['hourly'];
    $count = count($hourly['time']);

    // Priorités par défaut (best_match) ou personnalisées
    // - best_match en premier : fusion optimisée, plus précise en montagne
    // - Fallbacks sur modèles Météo-France spécifiques si best_match absent

    // Température, vent, précip totale
    $prio_hd = $priorities['hd'] ?? ['best_match', 'meteofrance_arome_france_hd', 'meteofrance_seamless', 'meteofrance_arome_france'];

    // Rain/snowfall/weather_code (best_match les a, sinon arome_france)
    $prio_decomp = $priorities['decomp'] ?? ['best_match', 'meteofrance_arome_france', 'meteofrance_seamless'];

    // Precipitation_probability (uniquement seamless et best_match)
    $prio_prob = $priorities['prob'] ?? ['meteofrance_seamless', 'best_match'];

    // Freezing level (isotherme 0)
    $prio_freezing = $priorities['freezing'] ?? ['best_match'];

    // Cloud cover (ARPEGE prioritaire si défini, sinon fallback sur decomp)
    $prio_cloud = $priorities['cloud'] ?? $prio_decomp;

    // Codes WMO de précipitation (utilisé à chaque heure pour détecter les incohérences)
    $precip_codes = range(51, 99);

    $rows = [];

    for ($i = 0; $i < $count; $i++) {
        $time = $hourly['time'][$i];
        
        // Température et vent
        $temp = get_model_value($hourly, 'temperature_2m', $i, $prio_hd);
        $apparent = get_model_value($hourly, 'apparent_temperature', $i, $prio_hd);
        $dew = get_model_value($hourly, 'dew_point_2m', $i, $prio_hd);
        $humidity = get_model_value($hourly, 'relative_humidity_2m', $i, $prio_hd);
        $wind_speed = get_model_value($hourly, 'wind_speed_10m', $i, $prio_hd);
        $wind_dir = get_model_value($hourly, 'wind_direction_10m', $i, $prio_hd);
        $wind_gusts = get_model_value($hourly, 'wind_gusts_10m', $i, $prio_hd);
        $cloud = get_model_value($hourly, 'cloud_cover', $i, $prio_cloud);

        // Précipitation totale
        $precip = get_model_value($hourly, 'precipitation', $i, $prio_hd) ?? 0;
        
        // Probabilité de précipitation
        $precip_prob = get_model_value($hourly, 'precipitation_probability', $i, $prio_prob) ?? 0;

        // Isotherme 0 - avec correction pour inversions thermiques
        // Priorité: selon $prio_freezing, fallback sur meteoswiss_icon_seamless si incohérent
        $freezing_point_raw = get_model_value($hourly, 'freezing_level_height', $i, $prio_freezing);
        $freezing_point_meteoswiss = $hourly['freezing_level_height_meteoswiss_icon_seamless'][$i] ?? null;
        $freezing_correction = correct_freezing_level($freezing_point_raw, $freezing_point_meteoswiss, $temp, $elevation);
        $freezing_point = $freezing_correction['value'];
        $freezing_corrected = $freezing_correction['corrected'];
        
        // Weather code - IMPORTANT pour determine_symbol quand pas de précipitations
        $weather_code = get_model_value($hourly, 'weather_code', $i, $prio_decomp);

        // ============================================================
        // CORRECTION INCOHÉRENCE WEATHER_CODE / PRÉCIPITATIONS
        // Open-Meteo "best_match" peut mixer des modèles incohérents :
        // weather_code=61 (pluie) mais précipitation totale nulle. On juge sur
        // le total, celui-là même que classe derive_hourly.
        //
        // Stratégie : fallback sur meteofrance_arome_france si incohérent,
        // puis correction basée sur cloud_cover en dernier recours.
        // ============================================================
        $has_precip_data = $precip > 0;

        if (in_array($weather_code, $precip_codes) && !$has_precip_data) {
            // Incohérence détectée : essayer meteofrance_arome_france
            $arome_prio = ['meteofrance_arome_france'];
            $arome_weather_code = get_model_value($hourly, 'weather_code', $i, $arome_prio);
            $arome_rain = get_model_value($hourly, 'rain', $i, $arome_prio);
            $arome_snowfall = get_model_value($hourly, 'snowfall', $i, $arome_prio);
            $arome_precip = get_model_value($hourly, 'precipitation', $i, $arome_prio) ?? 0;

            $arome_has_precip = ($arome_rain > 0 || $arome_snowfall > 0 || $arome_precip > 0);
            $arome_is_precip_code = in_array($arome_weather_code, $precip_codes);

            // AROME est cohérent ?
            if ($arome_weather_code !== null && ($arome_is_precip_code === $arome_has_precip)) {
                // Utiliser les données AROME (cohérentes)
                $weather_code = $arome_weather_code;
                $precip = $arome_precip;
            } else {
                // AROME aussi incohérent ou indisponible → correction basée sur cloud_cover
                $weather_code = ($cloud >= 80) ? 3 : (($cloud >= 37) ? 2 : (($cloud >= 12) ? 1 : 0));
            }
        }

        // ============================================================
        // CORRECTION WEATHER_CODE / CLOUD_COVER (cas inverse)
        // Si weather_code indique beau temps mais cloud_cover est élevé,
        // corriger le weather_code.
        // Seuils alignés sur les oktas WMO :
        //   0-11% = clair (0 okta), 12-36% = peu nuageux (1-2 oktas),
        //   37-79% = partiellement nuageux (3-6 oktas), 80%+ = couvert (7-8 oktas)
        // ============================================================
        if (in_array($weather_code, [0, 1, 2]) && $cloud !== null) {
            if ($cloud >= 80) {
                $weather_code = 3; // Couvert
            } elseif ($cloud >= 37) {
                $weather_code = max($weather_code, 2); // Partiellement nuageux
            } elseif ($cloud >= 12) {
                $weather_code = max($weather_code, 1); // Peu nuageux
            }
        }

        // UV index (préférer uv_index, fallback sur uv_index_clear_sky)
        $uv = get_model_value($hourly, 'uv_index', $i, $prio_hd);
        if ($uv === null) {
            $uv = get_model_value($hourly, 'uv_index_clear_sky', $i, $prio_hd);
        }
        // Les modèles Météo-France ne fournissent pas l'UV : la chaîne AROME prend celui de
        // best_match (le front le faisait en douce avant le format commun)
        if ($uv === null) {
            $uv = $hourly['uv_index_best_match'][$i] ?? null;
        }

        // is_day
        $is_day = get_model_value($hourly, 'is_day', $i, $prio_hd);
        if ($is_day === null) {
            $hour = (int)substr($time, 11, 2);
            $is_day = ($hour >= 7 && $hour < 17);
        }

        // Aucun modèle de la chaîne n'a de données à cette heure (au-delà de son horizon) :
        // la ligne reste vide plutôt que d'annoncer 0 mm, un ciel clair et un isotherme
        // "corrigé" à l'altitude du point
        if ($temp === null) {
            $precip = null;
            $freezing_point = null;
            $freezing_corrected = false;
            $weather_code = null;
        }

        // Modèle qui a servi ; pour best_match, celui qu'il recopie quand on le reconnaît
        $model = get_model_source($hourly, 'temperature_2m', $i, $prio_hd);
        if ($model === 'best_match') {
            $model = best_match_model($hourly, $i);
        }

        $rows[] = [
            'time' => $time,
            'model' => $model,
            'temperature' => $temp,
            'apparent_temperature' => $apparent,
            'dew_point' => $dew,
            'humidity' => $humidity,
            'wind_speed' => $wind_speed !== null ? $wind_speed / 3.6 : null,  // km/h → m/s
            'wind_direction' => $wind_dir,
            'wind_gusts' => $wind_gusts !== null ? $wind_gusts / 3.6 : null,
            'precipitation' => $precip,
            'precipitation_probability' => $precip_prob,
            'freezing_point' => $freezing_point,
            'freezing_point_corrected' => $freezing_corrected,
            'cloud_cover' => $cloud,
            'weather_code' => $weather_code,
            'symbol_code' => null,
            'showers' => null,
            'thunder' => null,
            'uv_index' => $uv,
            'is_day' => $is_day,
        ];
    }

    return $rows;
}

/**
 * MET.no → lignes horaires communes : une par heure (next_1_hours), ou une par pas de 6 h
 * aligné sur 0/6/12/18 UTC (next_6_hours).
 *
 * Température, vent, nuages et UV sont les valeurs instantanées au début de la période :
 * MET.no ne donne pas de moyenne. Pour le pas de 6 h, neige et pluie sont recalculées par
 * metno_six_hourly (température du début du pas trop peu fiable).
 * MET.no fournit sa propre icône : on n'en garde que la forme (averses, orage, jour/nuit) quand
 * il précipite, le type et l'intensité suivant nos quantités (voir derive_hourly). Son "ressenti"
 * (apparent_air_temperature) n'est pas repris : il affiche ~4°C de plus que la
 * température à -2°C sans vent.
 *
 * @param array $metno Réponse MET.no (endpoint complete)
 * @param string $period 'next_1_hours' ou 'next_6_hours'
 * @return array Lignes communes, plus temperature_min / temperature_max (pas de 6 h)
 */
function metno_rows($metno, $period = 'next_1_hours') {
    $rows = [];

    foreach ($metno['properties']['timeseries'] ?? [] as $entry) {
        $next = $entry['data'][$period] ?? null;
        $details = $entry['data']['instant']['details'] ?? null;
        if (!$next || !$details) continue;

        $time = substr($entry['time'], 0, 16);
        $hour = (int)substr($time, 11, 2);
        if ($period === 'next_6_hours' && $hour % 6 !== 0) continue;

        $temp = $details['air_temperature'] ?? null;
        $humidity = $details['relative_humidity'] ?? null;
        $symbol = $next['summary']['symbol_code'] ?? null;

        // Jour/nuit d'après le suffixe de l'icône MET.no, sinon même repli qu'Open-Meteo
        if (str_ends_with((string)$symbol, '_night')) {
            $is_day = false;
        } elseif (str_ends_with((string)$symbol, '_day')) {
            $is_day = true;
        } else {
            $is_day = ($hour >= 7 && $hour < 17);
        }

        $rows[] = [
            'time' => $time,
            'temperature' => $temp,
            'apparent_temperature' => null,
            'dew_point' => $details['dew_point_temperature'] ?? calculate_dew_point($temp, $humidity),
            'humidity' => $humidity,
            'wind_speed' => $details['wind_speed'] ?? null,  // déjà en m/s
            'wind_direction' => $details['wind_from_direction'] ?? null,
            'wind_gusts' => $details['wind_speed_of_gust'] ?? null,
            'precipitation' => $next['details']['precipitation_amount'] ?? 0,
            'precipitation_probability' => $next['details']['probability_of_precipitation'] ?? 0,
            'freezing_point' => null,
            'freezing_point_corrected' => false,
            'cloud_cover' => $details['cloud_area_fraction'] ?? null,
            'weather_code' => null,
            'symbol_code' => $symbol,
            'showers' => str_contains((string)$symbol, 'showers'),
            'thunder' => str_contains((string)$symbol, 'thunder'),
            'uv_index' => $details['ultraviolet_index_clear_sky'] ?? null,
            'is_day' => $is_day,
            'temperature_min' => $next['details']['air_temperature_min'] ?? null,
            'temperature_max' => $next['details']['air_temperature_max'] ?? null,
        ];
    }

    return $rows;
}

// ================= PIPELINE COMMUN =================

/**
 * Pipeline commun à toutes les sources : lignes horaires → tableau en colonnes enrichi.
 *
 * CLASSIFICATION NEIGE/PLUIE : la même règle pour toutes les sources. Le type est
 * décidé par la température humide (is_snow_conditions), la quantité de neige par
 * Roebber. La décomposition rain/snowfall des modèles n'est pas utilisée : best_match
 * annonce par exemple de la pluie à -1.5°C à 2590 m.
 * L'icône suit nos quantités : une source qui fournit la sienne (MET.no) ne la garde que
 * lorsqu'il ne tombe rien ; sinon on ne lui emprunte que sa forme (averses, orage), pour que
 * l'icône et les chiffres affichés concordent (MET.no annonçait "forte pluie" sur des pas
 * où l'app affichait des centimètres de neige).
 *
 * @param array $rows Lignes horaires communes (voir les adaptateurs)
 * @return array Colonnes : time, temperature, ..., symbol_code, snow_quality, uv_index, is_day
 */
function derive_hourly(array $rows) {
    $enriched = [
        'time' => [],
        'model' => [],  // Modèle qui a servi à cette heure (chaîne Open-Meteo), null sinon
        'temperature' => [],
        'apparent_temperature' => [],
        'dew_point' => [],
        'humidity' => [],
        'wind_speed' => [],
        'wind_direction' => [],
        'wind_gusts' => [],
        'precipitation' => [],
        'rain' => [],
        'snowfall' => [],
        'snowfall_roebber' => [],  // Identique à snowfall (Roebber), gardé pour le front
        'roebber_slr' => [],  // Ratio SLR Roebber utilisé
        'precipitation_probability' => [],
        'freezing_point' => [],
        'freezing_point_corrected' => [],  // true si valeur corrigée (inversion thermique)
        'cloud_cover' => [],
        'weather_code' => [],
        'symbol_code' => [],
        'snow_quality' => [],
        'uv_index' => [],
        'is_day' => []
    ];

    foreach ($rows as $row) {
        $temp = $row['temperature'];
        $dew = $row['dew_point'];

        if ($row['precipitation'] === null) {
            // Ligne sans données (au-delà de l'horizon de la source) : rien à classer ni à dessiner
            $classified = ['rain' => null, 'snowfall_roebber' => null, 'roebber_slr' => null];
            $rain = $snowfall = $symbol = null;
        } else {
            $classified = classify_precipitation($row['precipitation'], $temp, $dew, $row['humidity'], $row['wind_speed']);
            $rain = $classified['rain'];
            $snowfall = $classified['snowfall_roebber'];

            if ($row['symbol_code'] !== null && $snowfall <= 0 && $rain <= 0) {
                $symbol = $row['symbol_code'];
            } else {
                $symbol = determine_symbol($snowfall, $rain, $row['weather_code'], (bool)$row['is_day'], $row['showers'], $row['thunder']);
            }
        }

        $enriched['time'][] = $row['time'];
        $enriched['model'][] = $row['model'] ?? null;
        $enriched['temperature'][] = $temp;
        $enriched['apparent_temperature'][] = $row['apparent_temperature'];
        $enriched['dew_point'][] = $dew;
        $enriched['humidity'][] = $row['humidity'];
        $enriched['wind_speed'][] = $row['wind_speed'] !== null ? round($row['wind_speed'], 1) : null;
        $enriched['wind_direction'][] = $row['wind_direction'];
        $enriched['wind_gusts'][] = $row['wind_gusts'] !== null ? round($row['wind_gusts'], 1) : null;
        $enriched['precipitation'][] = $row['precipitation'] !== null ? round($row['precipitation'], 4) : null;
        $enriched['rain'][] = $rain;
        $enriched['snowfall'][] = $snowfall;
        $enriched['snowfall_roebber'][] = $classified['snowfall_roebber'];
        $enriched['roebber_slr'][] = $classified['roebber_slr'] !== null ? round($classified['roebber_slr'], 1) : null;
        $enriched['precipitation_probability'][] = $row['precipitation_probability'];
        $enriched['freezing_point'][] = $row['freezing_point'];
        $enriched['freezing_point_corrected'][] = $row['freezing_point_corrected'];
        $enriched['cloud_cover'][] = $row['cloud_cover'];
        $enriched['weather_code'][] = $row['weather_code'];
        $enriched['symbol_code'][] = $symbol;
        $enriched['snow_quality'][] = $snowfall !== null ? get_snow_quality($snowfall, $temp, $dew) : null;
        $enriched['uv_index'][] = $row['uv_index'] !== null ? round($row['uv_index'], 1) : null;
        $enriched['is_day'][] = $row['is_day'] ? 1 : 0;
    }

    return $enriched;
}

/**
 * Données horaires d'Open-Meteo pour une chaîne de priorités : adaptateur + pipeline commun.
 *
 * @param array $openmeteo Données brutes Open-Meteo
 * @param float $elevation Altitude de la station (depuis Open-Meteo)
 * @param array|null $priorities Priorités personnalisées (voir openmeteo_rows)
 */
function enrich_openmeteo_hourly($openmeteo, $elevation = null, $priorities = null) {
    if (!isset($openmeteo['hourly']['time'])) return null;

    return derive_hourly(openmeteo_rows($openmeteo, $elevation, $priorities));
}

/**
 * Agrège les données horaires en tranches de 6h
 * Pour les vues J+1, J+2
 */
function aggregate_hourly_to_6h($hourly) {
    if (!isset($hourly['time'])) return null;

    $six_hourly = [
        'time' => [],
        'temperature_min' => [],
        'temperature_max' => [],
        'wind_speed_max' => [],
        'wind_direction' => [],
        'precipitation' => [],
        'rain' => [],
        'snowfall' => [],
        'snowfall_roebber' => [],
        'precipitation_probability' => [],
        'freezing_point' => [],
        'freezing_point_corrected' => [],
        'weather_code' => [],
        'symbol_code' => [],
        'snow_quality' => [],
        'uv_index_max' => [],
        'cloud_cover' => []
    ];

    $count = count($hourly['time']);
    
    for ($i = 0; $i < $count; $i++) {
        $timestamp = $hourly['time'][$i];
        $hour = (int)substr($timestamp, 11, 2);
        
        if (!in_array($hour, [0, 6, 12, 18])) continue;
        
        // Accumulateurs pour la tranche de 6h
        $temps = [];
        $dew_points = [];
        $wind_speeds = [];
        $wind_dirs = [];
        $precip_sum = 0;
        $rain_sum = 0;
        $snowfall_sum = 0;
        $snowfall_roebber_sum = 0;
        $prob_max = 0;
        $uv_max = 0;
        $cloud_covers = [];
        $weather_codes = [];
        $freezing_points = [];
        $freezing_any_corrected = false;
        $is_day_dominant = ($hour >= 6 && $hour < 18);
        
        for ($j = 0; $j < 6 && ($i + $j) < $count; $j++) {
            $idx = $i + $j;
            
            if ($hourly['temperature'][$idx] !== null) {
                $temps[] = $hourly['temperature'][$idx];
            }
            if ($hourly['dew_point'][$idx] !== null) {
                $dew_points[] = $hourly['dew_point'][$idx];
            }
            if ($hourly['wind_speed'][$idx] !== null) {
                $wind_speeds[] = $hourly['wind_speed'][$idx];
            }
            if ($hourly['wind_direction'][$idx] !== null) {
                $wind_dirs[] = $hourly['wind_direction'][$idx];
            }
            
            $precip_sum += $hourly['precipitation'][$idx] ?? 0;
            $rain_sum += $hourly['rain'][$idx] ?? 0;
            $snowfall_sum += $hourly['snowfall'][$idx] ?? 0;
            $snowfall_roebber_sum += $hourly['snowfall_roebber'][$idx] ?? 0;
            $prob_max = max($prob_max, $hourly['precipitation_probability'][$idx] ?? 0);
            $uv_max = max($uv_max, $hourly['uv_index'][$idx] ?? 0);
            if (isset($hourly['cloud_cover'][$idx]) && $hourly['cloud_cover'][$idx] !== null) {
                $cloud_covers[] = $hourly['cloud_cover'][$idx];
            }

            // Collecter les freezing_point pour déterminer le dominant
            if (isset($hourly['freezing_point'][$idx]) && $hourly['freezing_point'][$idx] !== null) {
                $freezing_points[] = $hourly['freezing_point'][$idx];
                // Si une des valeurs est corrigée, on marque la tranche comme corrigée
                if (!empty($hourly['freezing_point_corrected'][$idx])) {
                    $freezing_any_corrected = true;
                }
            }
            
            // Collecter les weather_codes pour déterminer le dominant
            if (isset($hourly['weather_code'][$idx]) && $hourly['weather_code'][$idx] !== null) {
                $weather_codes[] = $hourly['weather_code'][$idx];
            }
        }

        // Déterminer le freezing_point moyen
        $average_freezing_point = null;
        if (!empty($freezing_points)) { 
            $avg_fpoint = array_sum($freezing_points) / count($freezing_points);
            $average_freezing_point = array_reduce(
                $freezing_points,
                function ($carry, $value) use ($avg_fpoint) {
                    return $carry === null ||
                           abs($value - $avg_fpoint) < abs($carry - $avg_fpoint)
                        ? $value
                        : $carry;
                },
                null
            );
        }
        
        // Déterminer le weather_code dominant (le plus élevé = plus sévère)
        $dominant_wmo = 0;
        if (!empty($weather_codes)) {
            $dominant_wmo = max($weather_codes);
        }
        
        // Déterminer l'icône basée sur les précipitations cumulées + weather_code dominant.
        // Intensité sur le débit horaire moyen du pas : les seuils sont horaires (3 mm en 6 h
        // est une pluie légère, pas une pluie)
        $symbol = determine_symbol($snowfall_sum / 6, $rain_sum / 6, $dominant_wmo, $is_day_dominant);
        
        // Si pas de précipitations, utiliser l'icône la plus fréquente de la tranche
        if ($snowfall_sum == 0 && $rain_sum == 0) {
            $symbol_counts = [];
            for ($j = 0; $j < 6 && ($i + $j) < $count; $j++) {
                $sym = $hourly['symbol_code'][$i + $j] ?? null;
                if ($sym !== null) {
                    $symbol_counts[$sym] = ($symbol_counts[$sym] ?? 0) + 1;
                }
            }
            if (!empty($symbol_counts)) {
                arsort($symbol_counts);
                $symbol = array_key_first($symbol_counts);
            }
        }
        
        // Qualité de neige pour la tranche (basée sur moyennes)
        $avg_temp = !empty($temps) ? array_sum($temps) / count($temps) : null;
        $avg_dew = !empty($dew_points) ? array_sum($dew_points) / count($dew_points) : null;
        $snow_quality = get_snow_quality($snowfall_sum, $avg_temp, $avg_dew);
        
        // Aucune heure du pas n'a de données (au-delà de l'horizon de la source) : le pas sort
        // vide, sans cumul à 0 ni icone de ciel clair
        $has_data = !empty($temps);

        $six_hourly['time'][] = $timestamp;
        $six_hourly['temperature_min'][] = !empty($temps) ? round(min($temps), 1) : null;
        $six_hourly['temperature_max'][] = !empty($temps) ? round(max($temps), 1) : null;
        $six_hourly['wind_speed_max'][] = !empty($wind_speeds) ? round(max($wind_speeds), 1) : null;
        $six_hourly['wind_direction'][] = !empty($wind_dirs) ? round(array_sum($wind_dirs) / count($wind_dirs)) : null;
        $six_hourly['precipitation'][] = $has_data ? round($precip_sum, 4) : null;
        $six_hourly['rain'][] = $has_data ? round($rain_sum, 4) : null;
        $six_hourly['snowfall'][] = $has_data ? round($snowfall_sum, 4) : null;
        $six_hourly['snowfall_roebber'][] = $has_data ? round($snowfall_roebber_sum, 2) : null;
        $six_hourly['precipitation_probability'][] = $prob_max;
        $six_hourly['freezing_point'][] = $average_freezing_point;
        $six_hourly['freezing_point_corrected'][] = $freezing_any_corrected;
        $six_hourly['weather_code'][] = $has_data ? $dominant_wmo : null;
        $six_hourly['symbol_code'][] = $has_data ? $symbol : null;
        $six_hourly['snow_quality'][] = $snow_quality;
        $six_hourly['uv_index_max'][] = $uv_max > 0 ? round($uv_max, 1) : null;
        $six_hourly['cloud_cover'][] = !empty($cloud_covers) ? round(array_sum($cloud_covers) / count($cloud_covers)) : null;
    }

    return $six_hourly;
}

/**
 * Répartit la précipitation d'un pas de 6 h entre neige et pluie, quand on ne connaît que
 * sa température minimale et maximale (MET.no au-delà de ~J+2).
 *
 * La température est supposée varier linéairement du min au max ; la part du pas où la
 * température humide reste sous le seuil tombe en neige, le reste en pluie. L'écart T - Td
 * est supposé constant. Testé sur 43 pas dont on connaissait les 6 heures : erreur 7.6 cm
 * de neige et 9.4 mm de pluie au total, contre 25.4 cm et 29.6 mm avec la température du
 * début du pas, et 10.1 cm / 13.9 mm avec la température moyenne.
 *
 * @return array ['snowfall' => cm, 'rain' => mm, 'snow_quality' => string|null]
 */
function split_precipitation_by_temperature_range($precip, $temp_min, $temp_max, $dew_depression, $humidity, $wind_speed) {
    if ($precip <= 0 || $temp_min === null || $temp_max === null) {
        return ['snowfall' => 0, 'rain' => 0, 'snow_quality' => null];
    }

    $wet_bulb_min = calculate_wet_bulb($temp_min, $temp_min - $dew_depression);
    $wet_bulb_max = calculate_wet_bulb($temp_max, $temp_max - $dew_depression);

    if ($wet_bulb_max <= SNOW_WET_BULB_THRESHOLD) {
        $snow_part = 1.0;
    } elseif ($wet_bulb_min > SNOW_WET_BULB_THRESHOLD) {
        $snow_part = 0.0;
    } else {
        $snow_part = (SNOW_WET_BULB_THRESHOLD - $wet_bulb_min) / ($wet_bulb_max - $wet_bulb_min);
    }

    // Roebber avec la température moyenne de la partie neigeuse du pas
    $snow_temp = $temp_min + $snow_part * ($temp_max - $temp_min) / 2;
    $snowfall = $snow_part > 0
        ? round(calculate_snowfall_from_slr($snow_part * $precip, calculate_roebber_slr($snow_temp, $humidity, $wind_speed)), 2)
        : 0;

    return [
        'snowfall' => $snowfall,
        'rain' => round((1 - $snow_part) * $precip, 4),
        'snow_quality' => get_snow_quality($snowfall, $snow_temp, $snow_temp - $dew_depression),
    ];
}

/**
 * MET.no → tableau 6 h au même format que aggregate_hourly_to_6h, un pas par tranche de
 * 0/6/12/18 UTC.
 *
 * Neige et pluie d'un pas : la somme de ses 6 heures quand MET.no les fournit (chacune
 * classée avec sa propre température), sinon la répartition selon le min/max du pas
 * (split_precipitation_by_temperature_range). Classer tout le pas avec la température
 * de son début donnait par ex. 6.5 cm de neige là où les heures disaient 2.4 cm puis
 * 5.4 mm de pluie. Une seule icône, construite depuis ces deux quantités.
 * Vent, nuages et UV sont les valeurs du début du pas : MET.no ne fournit pas de maximum.
 *
 * @param array $metno Réponse MET.no
 * @return array Colonnes 6 h
 */
function metno_six_hourly($metno) {
    $rows = metno_rows($metno, 'next_6_hours');
    $derived = derive_hourly($rows);  // vent, nuages, UV... ; précipitations recalculées ci-dessous

    $hourly = derive_hourly(metno_rows($metno));
    $hour_index = array_flip($hourly['time']);

    foreach ($rows as $n => $row) {
        // Les 6 heures du pas, si MET.no les fournit toutes
        $start = strtotime($row['time'] . 'Z');
        $hours = [];
        for ($k = 0; $k < 6; $k++) {
            $i = $hour_index[gmdate('Y-m-d\TH:i', $start + 3600 * $k)] ?? null;
            if ($i === null) {
                $hours = null;
                break;
            }
            $hours[] = $i;
        }

        if ($hours !== null) {
            $sum = fn($key) => array_sum(array_map(fn($i) => $hourly[$key][$i] ?? 0, $hours));
            $precip = $sum('precipitation');
            $snowfall = round($sum('snowfall'), 2);
            $rain = round($sum('rain'), 4);
            $snow_quality = get_snow_quality($snowfall, $sum('temperature') / 6, $sum('dew_point') / 6);
        } else {
            $precip = $row['precipitation'];
            $split = split_precipitation_by_temperature_range(
                $precip,
                $row['temperature_min'] ?? $row['temperature'],
                $row['temperature_max'] ?? $row['temperature'],
                max(0, $row['temperature'] - $row['dew_point']),
                $row['humidity'],
                $row['wind_speed']
            );
            ['snowfall' => $snowfall, 'rain' => $rain, 'snow_quality' => $snow_quality] = $split;
        }

        $derived['precipitation'][$n] = round($precip, 4);
        $derived['rain'][$n] = $rain;
        $derived['snowfall'][$n] = $snowfall;
        $derived['snowfall_roebber'][$n] = $snowfall;
        $derived['snow_quality'][$n] = $snow_quality;
        $derived['symbol_code'][$n] = ($snowfall <= 0 && $rain <= 0)
            ? $row['symbol_code']
            // Intensité sur le débit horaire moyen du pas, comme aggregate_hourly_to_6h
            : determine_symbol($snowfall / 6, $rain / 6, null, (bool)$row['is_day'], $row['showers'], $row['thunder']);
    }

    return [
        'time' => $derived['time'],
        'temperature_min' => array_map(fn($row) => $row['temperature_min'], $rows),
        'temperature_max' => array_map(fn($row) => $row['temperature_max'], $rows),
        'wind_speed_max' => $derived['wind_speed'],
        'wind_direction' => $derived['wind_direction'],
        'precipitation' => $derived['precipitation'],
        'rain' => $derived['rain'],
        'snowfall' => $derived['snowfall'],
        'snowfall_roebber' => $derived['snowfall_roebber'],
        'precipitation_probability' => $derived['precipitation_probability'],
        'freezing_point' => $derived['freezing_point'],
        'freezing_point_corrected' => $derived['freezing_point_corrected'],
        'weather_code' => $derived['weather_code'],
        'symbol_code' => $derived['symbol_code'],
        'snow_quality' => $derived['snow_quality'],
        'uv_index_max' => $derived['uv_index'],
        'cloud_cover' => $derived['cloud_cover'],
    ];
}

/**
 * Toutes les sources au format commun ({hourly, six_hourly} chacune) : la clé "forecasts",
 * seule donnée météo envoyée au front.
 *
 * @param array|null $openmeteo Données brutes Open-Meteo
 * @param array|null $metno Réponse MET.no (historique fusionné)
 * @param float|null $elevation Altitude du point
 * @return array ['openmeteo' => ..., 'arome' => ..., 'metno' => ...] (sources disponibles seulement)
 */
function build_forecasts($openmeteo, $metno, $elevation) {
    $forecasts = [];

    if (isset($openmeteo['hourly']['time'])) {
        foreach (['openmeteo' => null, 'arome' => arome_priorities()] as $source => $priorities) {
            $hourly = enrich_openmeteo_hourly($openmeteo, $elevation, $priorities);
            $forecasts[$source] = ['hourly' => $hourly, 'six_hourly' => aggregate_hourly_to_6h($hourly)];
        }
    }

    if (isset($metno['properties']['timeseries'])) {
        $forecasts['metno'] = [
            'hourly' => derive_hourly(metno_rows($metno)),
            'six_hourly' => metno_six_hourly($metno),
        ];
    }

    return $forecasts;
}

// ================= PRIORITÉS DE MODÈLES =================

/**
 * Chaîne de priorités "AROME" : modèles Météo-France uniquement, sans best_match.
 * Définie ici pour que le proxy et les tests partagent la même définition.
 *
 * Chaîne : arome_hd → arome → arpege → seamless (pas de fallback meteoswiss)
 * Cloud cover : ARPEGE prioritaire (AROME HD ne fournit pas la donnée, et AROME
 * standard est moins précis qu'ARPEGE comparé aux observations sur place).
 *
 * @return array Priorités par famille de champs
 */
function arome_priorities() {
    return [
        'hd'      => ['meteofrance_arome_france_hd', 'meteofrance_arome_france', 'meteofrance_arpege_seamless', 'meteofrance_seamless'],
        'decomp'  => ['meteofrance_arome_france', 'meteofrance_arpege_seamless', 'meteofrance_seamless'],
        'prob'    => ['meteofrance_seamless'],
        'freezing'=> ['meteofrance_arome_france_hd', 'meteofrance_arome_france', 'meteofrance_arpege_seamless', 'meteofrance_seamless'],
        'cloud'   => ['meteofrance_arpege_seamless', 'meteofrance_arome_france', 'meteofrance_seamless']
    ];
}

// ================= HISTORIQUE MET.NO =================

/**
 * Fusionne les timeseries MET.no du cache avec celles fraîchement reçues.
 *
 * MET.no ne renvoie que la fenêtre de prévision courante : sans ce merge, les
 * heures déjà écoulées de la journée disparaîtraient de l'affichage. On garde
 * donc les anciennes entrées, on écrase celles qui ont une nouvelle valeur, et
 * on purge ce qui précède le seuil.
 *
 * Le seuil est un paramètre (et non un strtotime('today midnight') interne)
 * pour rendre la fonction déterministe et testable.
 *
 * @param array $cached_timeseries Entrées issues du cache
 * @param array $new_timeseries Entrées fraîchement reçues de MET.no
 * @param int $cutoff_ts Timestamp sous lequel les entrées sont supprimées
 * @return array Timeseries fusionnées, triées chronologiquement et réindexées
 */
function merge_metno_timeseries(array $cached_timeseries, array $new_timeseries, $cutoff_ts) {
    // Indexer les nouvelles données par time
    $new_by_time = [];
    foreach ($new_timeseries as $entry) {
        $new_by_time[$entry['time']] = $entry;
    }

    // Merger : garder les anciennes, écraser/ajouter les nouvelles
    $merged = [];
    foreach ($cached_timeseries as $entry) {
        $time = $entry['time'];
        // Si on a une nouvelle valeur pour ce time, utiliser la nouvelle
        if (isset($new_by_time[$time])) {
            $merged[$time] = $new_by_time[$time];
            unset($new_by_time[$time]);
        } else {
            $merged[$time] = $entry;
        }
    }
    // Ajouter les nouvelles entrées qui n'existaient pas
    foreach ($new_by_time as $time => $entry) {
        $merged[$time] = $entry;
    }

    // Trier par time et réindexer
    ksort($merged);

    // Nettoyer : supprimer les entrées antérieures au seuil
    $merged = array_filter($merged, function($entry) use ($cutoff_ts) {
        return strtotime($entry['time']) >= $cutoff_ts;
    });

    return array_values($merged);
}
