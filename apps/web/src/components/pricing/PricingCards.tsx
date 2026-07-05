/**
 * PricingCards — client-side React island.
 *
 * Renders all 5 pricing tiers with:
 *   - Monthly / Annual cycle toggle
 *   - INR / USD currency toggle
 *   - Glassmorphism card style
 *   - "Most popular" badge on Team card
 *   - "Readers free" callout on Team + Business
 *   - Smart CTA: if user is logged in, upgrades go to billing settings
 */

import { useState, useEffect } from 'react';
import { TIERS } from '../../lib/pricing';
import type { BillingCycle, Currency, PricingTier } from '../../lib/pricing';

interface PricingCardsProps {
  /** Server-detected currency from CF-IPCountry */
  defaultCurrency: Currency;
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'rgba(255,255,255,0.55)' }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function formatPrice(amount: number, currency: Currency): string {
  if (currency === 'INR') {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
  return `$${amount}`;
}

function PricingCard({
  tier,
  cycle,
  currency,
  isLoggedIn,
}: {
  tier: PricingTier;
  cycle: BillingCycle;
  currency: Currency;
  isLoggedIn: boolean;
}) {
  const isHighlighted = tier.highlighted;
  const isEnterprise = tier.slug === 'enterprise';
  const isFree = tier.slug === 'free';

  const monthlyPrice =
    currency === 'INR' ? tier.inr_monthly : tier.usd_monthly;
  const annualDisplayPrice =
    currency === 'INR' ? tier.inr_annual : tier.usd_annual;

  const displayPrice = cycle === 'monthly' ? monthlyPrice : annualDisplayPrice;

  // Build CTA href
  let ctaHref = tier.cta.href;
  if (!isFree && !isEnterprise) {
    const billingDest = `/app/settings/billing?upgrade=${tier.slug}&cycle=${cycle}`;
    if (isLoggedIn) {
      // Already signed in → go straight to billing settings
      ctaHref = billingDest;
    } else {
      // Not signed in → /login with next= so post-auth lands on billing
      ctaHref = `/login?next=${encodeURIComponent(billingDest)}`;
    }
  }

  const cardStyle: React.CSSProperties = isHighlighted
    ? {
        position: 'relative',
        background: 'rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '0.5px solid rgba(255,255,255,0.15)',
        borderRadius: 20,
        padding: '32px 28px',
        overflow: 'hidden',
        // Top-edge glow
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 0 40px rgba(255,255,255,0.04)',
      }
    : {
        position: 'relative',
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '0.5px solid rgba(255,255,255,0.10)',
        borderRadius: 20,
        padding: '32px 28px',
        overflow: 'hidden',
      };

  return (
    <article style={cardStyle}>
      {/* Most popular badge */}
      {isHighlighted && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(255,255,255,0.12)',
            border: '0.5px solid rgba(255,255,255,0.20)',
            borderRadius: 100,
            padding: '3px 10px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.80)',
            textTransform: 'uppercase' as const,
          }}
        >
          Most popular
        </div>
      )}

      {/* Header */}
      <h3
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.90)',
          marginBottom: 4,
          letterSpacing: '-0.01em',
        }}
      >
        {tier.name}
      </h3>
      <p
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.40)',
          marginBottom: 24,
          lineHeight: 1.5,
        }}
      >
        {tier.tagline}
      </p>

      {/* Price */}
      {isEnterprise ? (
        <div style={{ marginBottom: 24 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.90)',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            Custom
          </span>
        </div>
      ) : (
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span
              style={{
                fontSize: isFree ? 36 : 40,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.95)',
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {isFree ? (currency === 'INR' ? '₹0' : '$0') : formatPrice(displayPrice!, currency)}
            </span>
            {!isFree && (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                {tier.perSeat ? '/ writer / mo' : '/ mo'}
              </span>
            )}
          </div>

          {/* Annual savings note */}
          {!isFree && cycle === 'annual' && (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
              Billed{' '}
              {currency === 'INR'
                ? `₹${tier.inr_annual_total!.toLocaleString('en-IN')}`
                : `$${tier.usd_annual_total}`}{' '}
              / year
            </p>
          )}
          {!isFree && cycle === 'monthly' && (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
              or{' '}
              {currency === 'INR'
                ? `₹${tier.inr_annual!} / mo`
                : `$${tier.usd_annual!} / mo`}{' '}
              billed annually
            </p>
          )}
        </div>
      )}

      {/* Readers free callout */}
      {tier.readersCallout && (
        <div
          style={{
            marginBottom: 20,
            marginTop: 12,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 8,
            fontSize: 11,
            color: 'rgba(255,255,255,0.50)',
          }}
        >
          ✦ Viewers (readers) are always free
        </div>
      )}

      <hr
        style={{
          border: 0,
          borderTop: '0.5px solid rgba(255,255,255,0.08)',
          margin: '20px 0',
        }}
      />

      {/* Features */}
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '0 0 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {tier.features.map((feat) => (
          <li
            key={feat.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'rgba(255,255,255,0.65)',
            }}
          >
            <CheckIcon />
            {feat.label}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <a
        href={ctaHref}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: 36,
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
          transition: 'background 0.15s, opacity 0.15s',
          ...(isHighlighted
            ? {
                background: 'rgba(255,255,255,0.92)',
                color: '#0a0a0a',
              }
            : {
                background: 'rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.80)',
                border: '0.5px solid rgba(255,255,255,0.12)',
              }),
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '0.85';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
      >
        {tier.cta.label}
      </a>
    </article>
  );
}

export function PricingCards({ defaultCurrency }: PricingCardsProps) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check auth status client-side
  useEffect(() => {
    fetch('/api/billing/current', { credentials: 'include' })
      .then((r) => { if (r.ok) setIsLoggedIn(true); })
      .catch(() => {});
  }, []);

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 14px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    transition: 'background 0.15s, color 0.15s',
    ...(active
      ? {
          background: 'rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.90)',
        }
      : {
          background: 'transparent',
          color: 'rgba(255,255,255,0.35)',
        }),
  });

  return (
    <div>
      {/* Toggles */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          marginBottom: 40,
        }}
      >
        {/* Cycle toggle */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.05)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}
        >
          <button
            style={toggleStyle(cycle === 'monthly')}
            onClick={() => setCycle('monthly')}
          >
            Monthly
          </button>
          <button
            style={toggleStyle(cycle === 'annual')}
            onClick={() => setCycle('annual')}
          >
            Annual
            {cycle === 'annual' && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: 9,
                  background: 'rgba(74,222,128,0.15)',
                  color: '#4ade80',
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                −20%
              </span>
            )}
            {cycle !== 'annual' && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: 9,
                  background: 'rgba(74,222,128,0.10)',
                  color: '#4ade80',
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                −20%
              </span>
            )}
          </button>
        </div>

        {/* Currency toggle */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.05)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}
        >
          <button
            style={toggleStyle(currency === 'INR')}
            onClick={() => setCurrency('INR')}
          >
            ₹ INR
          </button>
          <button
            style={toggleStyle(currency === 'USD')}
            onClick={() => setCurrency('USD')}
          >
            $ USD
          </button>
        </div>
      </div>

      {/* Cards grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {TIERS.map((tier) => (
          <PricingCard
            key={tier.slug}
            tier={tier}
            cycle={cycle}
            currency={currency}
            isLoggedIn={isLoggedIn}
          />
        ))}
      </div>
    </div>
  );
}
