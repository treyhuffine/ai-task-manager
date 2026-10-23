'use client';

import { Component, type ReactNode } from 'react';

/** A render failure stays inside its Home document. Saved drafts remain scoped. */
export class HomeErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="p-6 text-sm">This view could not load. Your saved drafts are kept. <button className="underline" onClick={() => this.setState({ failed: false })}>Try again</button></div>;
    return this.props.children;
  }
}
