import * as Sentry from '@sentry/astro';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  eventId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.setState({ eventId: eventId ?? null });
  }

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            padding: '24px',
          }}
        >
          <div
            style={{
              background: 'var(--surface, #18181b)',
              border: '1px solid var(--line, #27272a)',
              borderRadius: '10px',
              padding: '28px 32px',
              maxWidth: '420px',
              width: '100%',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                color: 'var(--ink, #fafafa)',
                fontSize: '15px',
                fontWeight: 600,
                margin: '0 0 8px',
              }}
            >
              Something went wrong
            </p>
            <p
              style={{
                color: 'var(--ink-muted, #71717a)',
                fontSize: '13px',
                margin: '0 0 20px',
                lineHeight: 1.5,
              }}
            >
              An unexpected error occurred. The team has been notified.
            </p>
            {this.state.eventId && (
              <p
                style={{
                  color: 'var(--ink-muted, #71717a)',
                  fontSize: '11px',
                  margin: '0 0 16px',
                  fontFamily: 'var(--mono, monospace)',
                }}
              >
                Error ID: {this.state.eventId}
              </p>
            )}
            <button
              onClick={this.handleRefresh}
              style={{
                background: 'var(--accent, #6366f1)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Refresh the page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
