export const STAGE_LABELS: Record<string, string> = {
  PERSIAPAN: "Persiapan Likuidasi",
  PENGAMANAN_ASET: "Pengamanan Aset",
  PENUNJUKAN_TL: "Penunjukan TL",
  OPERASIONAL: "Pemberesan (Operasional)",
  NERACA_PENUTUPAN: "Neraca Penutupan",
  PENGAKHIRAN: "Pengakhiran Likuidasi",
  SELESAI: "Selesai",
};

export const STAGE_ORDER = Object.keys(STAGE_LABELS);

export const COUNTERPARTY_LABELS: Record<string, string> = {
  DEBITUR: "Debitur",
  KREDITUR: "Kreditur",
  KREDITUR_SEPARATIS: "Kreditur separatis",
  PEMBELI: "Pembeli",
  TIM_LIKUIDASI: "Tim Likuidasi",
  LAINNYA: "Lainnya",
};

export const TL_END_REASON_LABELS: Record<string, string> = {
  MENINGGAL: "Meninggal dunia",
  ROTASI: "Rotasi antar-BDL",
  PEMBERHENTIAN_LAIN: "Pemberhentian lain",
  BERAKHIR_MASA_TUGAS: "Berakhir masa tugas",
};

export const ACCOUNT_CLASS_LABELS: Record<string, string> = {
  ASSET: "Aset",
  CONTRA_ASSET: "Penyisihan (PPAP)",
  LIABILITY: "Kewajiban",
};
