export interface BoatConfig {
  name: string;
  length_m: number;
  width_m: number;
  capacity: number;
  engine: string;
  tank_l: number;
  base_l_per_km: number;
  payload_t: string;
  reserve_frac_tank: number;
}

export interface SurfaceConfig {
  label: string;
  spd: number; // base speed in km/h
  k_surf: number; // fuel multiplier
  risk: number; // risk score 1-10
  planing: boolean; // support planing
  hard: boolean; // is hard surface (e.g. rocks, marsh)
}

export interface OptimizationMode {
  obj: 'time' | 'fuel' | 'length' | 'risk';
  k_mode: number;
  desc: string;
}

export interface Edge {
  from: string;
  to: string;
  km: number;
  surface: 'water' | 'ice' | 'shallow' | 'grass' | 'slush' | 'rocks' | 'marsh';
}

export interface NodePosition {
  name: string;
  lat: number;
  lng: number;
  label: string;
  isStart?: boolean;
  isFinish?: boolean;
}

export const SCENARIO = {
  name: "Кубок Енисея — цифровой штурман аэролодки",
  area: "Красноярское вдхр., Дивногорск (КрасГЭС) → залив Бирюса (ТИМ)",
  season: "зима (синтетические данные-допущение)",
  start: "Дивногорск",
  finish: "Бирюса",
  offline_first: true
};

export const BOAT: BoatConfig = {
  name: "Raptor 650",
  length_m: 6.9,
  width_m: 2.45,
  capacity: 6,
  engine: "Honda J35, 280 л.с.",
  tank_l: 370,
  base_l_per_km: 0.8,
  payload_t: "1.0–1.5",
  reserve_frac_tank: 0.2
};

export const BLOW_CONFIGS = {
  "без поддува": {
    k_load: 1.0,
    allow_hard: false,
    description: "Аэролодка без дополнительного нагнетания воздуха под днище. Запрещен выход на твердые абразивные поверхности (камни, болото)."
  },
  "с поддувом": {
    k_load: 1.12,
    allow_hard: true,
    description: "Включена вспомогательная система поддува. Повышенный расход (+12%), но разрешено преодоление камней и болотистых участков."
  }
};

export const SURFACES: Record<string, SurfaceConfig> = {
  water: {
    label: "вода (открытая)",
    spd: 58,
    k_surf: 1.0,
    risk: 2,
    planing: true,
    hard: false
  },
  ice: {
    label: "лёд",
    spd: 64,
    k_surf: 0.9,
    risk: 1,
    planing: true,
    hard: false
  },
  shallow: {
    label: "мелководье",
    spd: 34,
    k_surf: 1.4,
    risk: 4,
    planing: false,
    hard: false
  },
  grass: {
    label: "трава/камыш",
    spd: 30,
    k_surf: 1.5,
    risk: 3,
    planing: false,
    hard: false
  },
  slush: {
    label: "шуга/наледь",
    spd: 28,
    k_surf: 1.7,
    risk: 4,
    planing: false,
    hard: false
  },
  rocks: {
    label: "камни",
    spd: 24,
    k_surf: 1.65,
    risk: 6,
    planing: false,
    hard: true
  },
  marsh: {
    label: "болото",
    spd: 20,
    k_surf: 1.9,
    risk: 7,
    planing: false,
    hard: true
  }
};

export const MODES: Record<string, OptimizationMode> = {
  "быстрый": {
    obj: "time",
    k_mode: 1.15,
    desc: "Минимум расчётного времени в пути"
  },
  "экономичный": {
    obj: "fuel",
    k_mode: 0.95,
    desc: "Минимум расхода топлива"
  },
  "кратчайший": {
    obj: "length",
    k_mode: 1.0,
    desc: "Минимум дистанции с учётом ограничений"
  },
  "безопасный": {
    obj: "risk",
    k_mode: 1.05,
    desc: "Обход зон повышенного риска"
  }
};

export const MAP_NODES: Record<string, NodePosition> = {
  "Дивногорск": { name: "Дивногорск", lat: 55.9320, lng: 92.2850, label: "Дивногорск (КрасГЭС)", isStart: true },
  "Полынья": { name: "Полынья", lat: 55.8850, lng: 92.2050, label: "Полынья (зона открытой воды)" },
  "Лёд-1": { name: "Лёд-1", lat: 55.9020, lng: 92.2400, label: "Участок Лёд-1" },
  "Камни": { name: "Камни", lat: 55.9180, lng: 92.2550, label: "Каменистая коса" },
  "Болото": { name: "Болото", lat: 55.8650, lng: 92.1750, label: "Заболоченная отмель" },
  "Узел-М": { name: "Узел-М", lat: 55.8450, lng: 92.1100, label: "Узел-М (Развилка)" },
  "Шуга": { name: "Шуга", lat: 55.8250, lng: 92.0200, label: "Шуга / наледь у берега" },
  "Чисто": { name: "Чисто", lat: 55.8150, lng: 92.0500, label: "Чистый ровный лед" },
  "Бирюса": { name: "Бирюса", lat: 55.7850, lng: 91.9550, label: "залив Бирюса (ТИМ)", isFinish: true }
};

export const EDGES: Edge[] = [
  { from: "Дивногорск", to: "Полынья", km: 8, surface: "water" },
  { from: "Полынья", to: "Узел-М", km: 15, surface: "ice" },
  { from: "Дивногорск", to: "Лёд-1", km: 11, surface: "ice" },
  { from: "Лёд-1", to: "Узел-М", km: 13, surface: "ice" },
  { from: "Дивногорск", to: "Камни", km: 6, surface: "rocks" },
  { from: "Камни", to: "Узел-М", km: 11, surface: "ice" },
  { from: "Дивногорск", to: "Болото", km: 7, surface: "marsh" },
  { from: "Болото", to: "Узел-М", km: 12, surface: "ice" },
  { from: "Узел-М", to: "Шуга", km: 9, surface: "slush" },
  { from: "Шуга", to: "Бирюса", km: 6, surface: "shallow" },
  { from: "Узел-М", to: "Чисто", km: 13, surface: "ice" },
  { from: "Чисто", to: "Бирюса", km: 9, surface: "ice" }
];
