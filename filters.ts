import * as tr from "./transformers";
import * as ur from "./uniform-resource";

export interface UniformResourceFilter {
    retainOriginal?(resource: ur.UniformResource): boolean;
    retainTransformed?(resource: ur.UniformResource | tr.TransformedResource): boolean;
}

export interface UniformResourceFilterReporter {
    (resource: ur.UniformResource): void;
}

export function filterPipe(...chain: UniformResourceFilter[]): UniformResourceFilter {
    return new class implements UniformResourceFilter {
        retainOriginal(resource: ur.UniformResource): boolean {
            for (const c of chain) {
                if (c.retainOriginal) {
                    if (!c.retainOriginal(resource)) {
                        return false;
                    }
                }
            }
            return true;
        }

        retainTransformed(resource: tr.TransformedResource): boolean {
            for (const c of chain) {
                if (c.retainTransformed) {
                    if (!c.retainTransformed(resource)) {
                        return false;
                    }
                }
            }
            return true;
        }
    }()
}

export class FilteredResourcesCounter {
    readonly reporters: {
        [key: string]: {
            removedCount: number;
            reporter: UniformResourceFilterReporter
        }
    } = {};

    count(key: string): number {
        return this.reporters[key].removedCount;
    }

    reporter(key: string): UniformResourceFilterReporter {
        const reporter = (resource: ur.UniformResource): void => {
            this.reporters[key].removedCount++;
        }
        this.reporters[key] = {
            removedCount: 0,
            reporter: reporter
        }
        return reporter;
    }
}

export class BlankLabelFilter implements UniformResourceFilter {
    static readonly singleton = new BlankLabelFilter();

    constructor(readonly reporter?: UniformResourceFilterReporter) {
    }

    retainOriginal(resource: ur.UniformResource): boolean {
        if (typeof resource.label === "undefined" || resource.label.length == 0) {
            if (this.reporter) {
                this.reporter(resource);
            }
            return false;
        }
        return true;
    }
}

export class BrowserTraversibleFilter implements UniformResourceFilter {
    static readonly singleton = new BrowserTraversibleFilter();

    constructor(readonly reporter?: UniformResourceFilterReporter) {
    }

    retainOriginal(resource: ur.UniformResource): boolean {
        if (resource.uri.startsWith("mailto:")) {
            if (this.reporter) {
                this.reporter(resource);
            }
            return false;
        }
        return true;
    }
}
