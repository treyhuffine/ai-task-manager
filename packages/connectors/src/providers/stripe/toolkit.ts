/**
 * The `stripe` toolkit — read-first (customers, charges, invoices, subscriptions) plus a guarded
 * create_customer. Non-OAuth, so no `scopes`. Reads are GET+query; the write is form-encoded.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { stripeForm } from './provider';

interface ListResponse {
  data?: unknown[];
  has_more?: boolean;
}

function list(raw: unknown) {
  const r = raw as ListResponse;
  return { data: r.data ?? [], has_more: !!r.has_more };
}

export const stripeToolkit = defineToolkit({
  id: 'stripe',
  providerId: 'stripe',
  displayName: 'Stripe',
  actions: [
    httpAction({
      id: 'stripe.list_customers',
      description: 'List customers (optionally filter by email).',
      input: z.object({ limit: z.number().int().positive().max(100).default(10), email: z.string().optional() }),
      request: (i) => ({ method: 'GET', path: '/customers', query: { limit: i.limit, email: i.email } }),
      output: list,
    }),
    httpAction({
      id: 'stripe.get_customer',
      description: 'Get a customer by id.',
      input: z.object({ customerId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/customers/${encodeURIComponent(i.customerId)}` }),
      output: (raw) => raw,
    }),
    httpAction({
      id: 'stripe.list_charges',
      description: 'List recent charges.',
      input: z.object({ limit: z.number().int().positive().max(100).default(10), customer: z.string().optional() }),
      request: (i) => ({ method: 'GET', path: '/charges', query: { limit: i.limit, customer: i.customer } }),
      output: list,
    }),
    httpAction({
      id: 'stripe.list_invoices',
      description: 'List invoices.',
      input: z.object({ limit: z.number().int().positive().max(100).default(10), customer: z.string().optional() }),
      request: (i) => ({ method: 'GET', path: '/invoices', query: { limit: i.limit, customer: i.customer } }),
      output: list,
    }),
    httpAction({
      id: 'stripe.list_subscriptions',
      description: 'List subscriptions.',
      input: z.object({ limit: z.number().int().positive().max(100).default(10), customer: z.string().optional() }),
      request: (i) => ({ method: 'GET', path: '/subscriptions', query: { limit: i.limit, customer: i.customer } }),
      output: list,
    }),
    httpAction({
      id: 'stripe.create_customer',
      description: 'Create a customer.',
      mutating: true,
      risk: 'high',
      input: z.object({ email: z.string().optional(), name: z.string().optional(), description: z.string().optional() }),
      request: (i) => ({
        method: 'POST',
        path: '/customers',
        rawBody: stripeForm({ email: i.email, name: i.name, description: i.description }),
        contentType: 'application/x-www-form-urlencoded',
      }),
      output: (raw) => raw,
    }),
  ],
});
