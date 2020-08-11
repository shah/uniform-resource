# Uniform Resources Management System

NodeJS uniform resource suppliers and consumers for content orchestration engines.
Allows "smart" processing of bookmarks, tweets, email links, etc.

# Usage

Here's the simplest usage. Check out the test specs for more complex use cases.

```typescript
    import * as filters from "./filters";
    import * as follow from "./follow-urls";
    import * as s from "./suppliers";
    import * as tr from "./transformers";
    import * as ur from "./uniform-resource";

    // the supplier is thread-safe and reusable for multiple URLs
    const supplier = new s.TypicalResourcesSupplier({
        originURN: '(your source)',
        transformer: tr.transformationPipe(
            tr.FollowRedirectsGranular.singleton)
    })
    const ctx: ur.UniformResourceContext = {
        isUniformResourceContext: true
    }

    // this method is the entrypoint for a single resource to be created from a URL
    const resource = await supplier.resourceFromAnchor(ctx, { href: "https://t.co/fDxPF" });
    if(ur.isInvalidResource(resource)) {
        // resource.error gives the reason
    } else {
        if(tr.isFollowedResource(resource)) {
            // this means that the resource was successfuly "followed" (redirected)
            console.log("The final, terminated URL:", resource.uri);
            if (follow.isTerminalTextContentResult(resource.terminalResult)) {
                // this means that the resource was determined to be a text/HTML resource
                console.log("Title", resource.content?.title);
                console.dir("Social Graph", resource.content?.socialGraph);
            }
        }
    }
```