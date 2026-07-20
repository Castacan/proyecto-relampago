export const GRADE_POINTS: Record<string, number> = {
  V0: 1, V1: 2, V2: 3, V3: 4, V4: 5,
  V5: 6, V6: 7, V7: 8, V8: 9, V9: 10,
}

export function getGradePoints(grade: string): number {
  return GRADE_POINTS[grade] ?? 1
}
