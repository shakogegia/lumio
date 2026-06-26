import type { Prisma } from "@lumio/db";
import {
  type CalendarField,
  calendarColumn,
  monthRange,
  monthStringRange,
  parseCalendarMetaField,
} from "@lumio/shared";

/**
 * The month-filter `where` clause for a date dimension. Standard dimensions
 * filter their Photo column with a UTC Date range; a metadata dimension filters
 * the child table with an ISO `YYYY-MM-DD` text range (index-backed on value).
 */
export function calendarWhere(field: CalendarField, month: string): Prisma.PhotoWhereInput {
  const fieldId = parseCalendarMetaField(field);
  if (fieldId) {
    const { gte, lt } = monthStringRange(month);
    return { metadataValues: { some: { fieldId, value: { gte, lt } } } };
  }
  return { [calendarColumn(field)]: monthRange(month) } as Prisma.PhotoWhereInput;
}
