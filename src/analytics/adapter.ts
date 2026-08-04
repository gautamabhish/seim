export interface UserProfile {
  userId: string;
  properties: Record<string, any>;
  cohorts: string[];
  firstSeen: number;
  lastSeen: number;
}

export interface AnalyticsEvent {
  event: string;
  userId: string;
  properties: Record<string, any>;
  timestamp: number;
}

export class AnalyticsAdapter {
  private provider: 'mixpanel' | 'amplitude' | 'ga' | 'custom' | null = null;
  private apiKey?: string;
  private customHandler?: (event: AnalyticsEvent) => void;
  private eventQueue: AnalyticsEvent[] = [];
  private maxQueueSize = 1000;

  /**
   * Integrate with Mixpanel
   */
  integrateMixpanel(apiKey: string): void {
    this.provider = 'mixpanel';
    this.apiKey = apiKey;
    console.log('Analytics: Mixpanel integration enabled');
  }

  /**
   * Integrate with Amplitude
   */
  integrateAmplitude(apiKey: string): void {
    this.provider = 'amplitude';
    this.apiKey = apiKey;
    console.log('Analytics: Amplitude integration enabled');
  }

  /**
   * Integrate with Google Analytics
   */
  integrateGoogleAnalytics(measurementId: string): void {
    this.provider = 'ga';
    this.apiKey = measurementId;
    console.log('Analytics: Google Analytics integration enabled');
  }

  /**
   * Set up custom analytics handler
   */
  integrateCustom(handler: (event: AnalyticsEvent) => void): void {
    this.provider = 'custom';
    this.customHandler = handler;
    console.log('Analytics: Custom integration enabled');
  }

  /**
   * Track an analytics event
   */
  trackEvent(userId: string, event: string, properties: Record<string, any> = {}): void {
    const analyticsEvent: AnalyticsEvent = {
      event,
      userId,
      properties,
      timestamp: Date.now()
    };

    if (this.provider === 'custom' && this.customHandler) {
      this.customHandler(analyticsEvent);
    } else {
      // Queue events for batch processing
      this.eventQueue.push(analyticsEvent);
      
      if (this.eventQueue.length >= this.maxQueueSize) {
        this.flushEvents();
      }
    }
  }

  /**
   * Get user profile from analytics provider
   */
  async getUserProfile(userId: string): Promise<UserProfile> {
    // In production, this would call the actual analytics API
    // For now, return a basic profile
    return {
      userId,
      properties: {},
      cohorts: [],
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };
  }

  /**
   * Get user cohorts from analytics provider
   */
  async getUserCohorts(userId: string): Promise<string[]> {
    const profile = await this.getUserProfile(userId);
    return profile.cohorts;
  }

  /**
   * Flush queued events to the analytics provider
   */
  private flushEvents(): void {
    if (this.eventQueue.length === 0) return;

    if (this.provider === 'mixpanel') {
      this.flushToMixpanel();
    } else if (this.provider === 'amplitude') {
      this.flushToAmplitude();
    } else if (this.provider === 'ga') {
      this.flushToGA();
    }

    this.eventQueue = [];
  }

  /**
   * Flush events to Mixpanel
   */
  private flushToMixpanel(): void {
    // In production, use the Mixpanel SDK
    console.log(`Flushing ${this.eventQueue.length} events to Mixpanel`);
    // Example: mixpanel.people.set(userId, properties)
  }

  /**
   * Flush events to Amplitude
   */
  private flushToAmplitude(): void {
    // In production, use the Amplitude SDK
    console.log(`Flushing ${this.eventQueue.length} events to Amplitude`);
    // Example: amplitude.getInstance().logEvent(event, properties)
  }

  /**
   * Flush events to Google Analytics
   */
  private flushToGA(): void {
    // In production, use the GA4 Measurement Protocol
    console.log(`Flushing ${this.eventQueue.length} events to Google Analytics`);
    // Example: send to GA4 Measurement Protocol API
  }

  /**
   * Set user properties
   */
  setUserProperties(userId: string, properties: Record<string, any>): void {
    this.trackEvent(userId, '$set', properties);
  }

  /**
   * Alias user IDs (for when a user identifies themselves)
   */
  alias(userId: string, previousId: string): void {
    this.trackEvent(userId, '$alias', { previous_id: previousId });
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    queueSize: number;
    maxQueueSize: number;
    provider: string | null;
  } {
    return {
      queueSize: this.eventQueue.length,
      maxQueueSize: this.maxQueueSize,
      provider: this.provider
    };
  }

  /**
   * Force flush all queued events
   */
  forceFlush(): void {
    this.flushEvents();
  }

  /**
   * Clear the event queue
   */
  clearQueue(): void {
    this.eventQueue = [];
  }
}