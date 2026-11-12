export type Rating = 1 | 2 | 3 | 4 | 5;

export function isRating(value: unknown): value is Rating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function ratingColumns(rating: Rating | null) {
  return {
    rating,
    ratingRecordedAt: rating === null ? null : new Date(),
  };
}
