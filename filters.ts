import * as ur from "./uniform-resource";

export function chainedFilter(...chain: ur.UniformResourceFilter[]): ur.UniformResourceFilter {
    return new class implements ur.UniformResourceFilter {
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

        retainTransformed(resource: ur.TransformedResource): boolean {
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
            reporter: ur.UniformResourceFilterReporter
        }
    } = {};

    count(key: string): number {
        return this.reporters[key].removedCount;
    }

    reporter(key: string): ur.UniformResourceFilterReporter {
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

export class BlankLabelFilter implements ur.UniformResourceFilter {
    static readonly singleton = new BlankLabelFilter();

    constructor(readonly reporter?: ur.UniformResourceFilterReporter) {
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

export class BrowserTraversibleFilter implements ur.UniformResourceFilter {
    static readonly singleton = new BrowserTraversibleFilter();

    constructor(readonly reporter?: ur.UniformResourceFilterReporter) {
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
