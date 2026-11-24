import { AlertCircle, RotateCw } from 'lucide-react';
import { Skeleton } from './ui.js';
import { useI18n } from '../lib/i18n.js';

/**
 * Shared page-level states. Using the same skeleton and error treatment on
 * every screen keeps loading and failure moments calm and predictable.
 */
export function PageLoading({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <div className="page-loading__head">
        <Skeleton height={26} width="34%" radius={8} />
        <Skeleton height={14} width="20%" />
      </div>
      <div className="page-loading__grid">
        <Skeleton height={96} radius={12} />
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={64} radius={12} />)}
      </div>
    </div>
  );
}

/**
 * The message is a direct text child of `.error-banner` so existing screens
 * and tests that target that element keep working unchanged.
 */
export function PageError({ message, onRetry }: { message: string; onRetry?: () => void | Promise<void> }) {
  const { t } = useI18n();
  return (
    <div className="page-error-wrap">
      <div className="error-banner" role="alert">
        <AlertCircle size={18} aria-hidden="true" />
        {message}
        {onRetry && (
          <button type="button" className="error-banner__retry" aria-label={t('retry')}
            onClick={() => void onRetry()}>
            <RotateCw size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
