import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { gunzipSync } from 'zlib';
import { GcsService } from '../gcs/gcs.service';

export const BRANDS_ENRICHMENT_OBJECT =
    process.env.BRANDS_ENRICHMENT_OBJECT || 'enrichment/brands-v1.ndjson.gz';

// The artifact is rebuilt monthly; a daily staleness check picks a new build
// up within a day, matching the divisions search index behaviour.
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface BrandEnrichment {
    qid: string;
    label?: string;
    logo_url?: string;
    website?: string;
    industry?: string;
    parent?: string;
    updated_at?: string;
}

/**
 * In-memory Wikidata brand enrichment (~3k rows, CC0-licensed). Loaded from a
 * gzipped NDJSON artifact in GCS that `npm run etl:brands-enrichment`
 * rebuilds monthly. Serving is a zero-cost Map lookup by QID; when the
 * artifact is missing or fails to load, isReady() stays false and responses
 * simply omit the ext_ brand fields — a pure additive optimisation with no
 * availability risk.
 */
@Injectable()
export class BrandsEnrichmentService implements OnModuleInit, OnModuleDestroy {
    logger = new Logger('BrandsEnrichmentService');

    private brands = new Map<string, BrandEnrichment>();
    private ready = false;
    private loading = false;
    private loadedGeneration: string | null = null;
    private refreshTimer?: NodeJS.Timeout;

    constructor(private readonly gcsService: GcsService) { }

    onModuleInit() {
        if (process.env.NODE_ENV === 'test' || process.env.BRANDS_ENRICHMENT_ENABLED === 'false') {
            return;
        }
        void this.loadIfStale();
        this.refreshTimer = setInterval(() => void this.loadIfStale(), REFRESH_INTERVAL_MS);
        this.refreshTimer.unref?.();
    }

    onModuleDestroy() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
    }

    isReady(): boolean {
        return this.ready;
    }

    get(qid: string | undefined | null): BrandEnrichment | undefined {
        if (!qid) return undefined;
        return this.brands.get(qid);
    }

    size(): number {
        return this.brands.size;
    }

    async loadIfStale(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const generation = await this.gcsService.getObjectGeneration(BRANDS_ENRICHMENT_OBJECT);
            if (!generation) {
                this.logger.warn(`Brands enrichment artifact not found in GCS (${BRANDS_ENRICHMENT_OBJECT}); brand ext_ fields disabled. Run "npm run etl:brands-enrichment" to build it.`);
                return;
            }
            if (generation === this.loadedGeneration) return;

            const compressed = await this.gcsService.downloadObject(BRANDS_ENRICHMENT_OBJECT);
            if (!compressed) return;

            this.loadFromNdjson(gunzipSync(compressed).toString('utf8'));
            this.loadedGeneration = generation;
            this.logger.log(`Brands enrichment loaded: ${this.brands.size} brands (GCS generation ${generation})`);
        } catch (error) {
            this.logger.error(`Failed to load brands enrichment: ${error.message}`);
        } finally {
            this.loading = false;
        }
    }

    /** Exposed for tests and for loading from a local artifact. */
    loadFromNdjson(ndjson: string): void {
        const brands = new Map<string, BrandEnrichment>();
        for (const line of ndjson.split('\n')) {
            if (!line) continue;
            const row = JSON.parse(line) as BrandEnrichment;
            if (row.qid) brands.set(row.qid, row);
        }
        this.brands = brands;
        this.ready = brands.size > 0;
    }
}
