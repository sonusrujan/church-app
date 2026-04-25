import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, total, onPageChange }: PaginationProps) {
  if (total <= 1) return null;

  return (
    <nav className="pagination" role="navigation" aria-label="Pagination">
      <button
        className="btn pagination-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="pagination-info">
        {page} / {total}
      </span>
      <button
        className="btn pagination-btn"
        disabled={page >= total}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}

/** Paginate an array: returns the slice for the given 1-based page */
export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

export function totalPages(count: number, perPage: number): number {
  return Math.max(1, Math.ceil(count / perPage));
}
