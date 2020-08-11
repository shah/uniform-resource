# Uniform Resources Management System

TypeScript based NodeJS uniform resource suppliers and consumers for content orchestration engines.

Allows "smart" processing of bookmarks, tweets, email links, etc.

# Developer Onboarding

Start the `.devcontainer` or use local NodeJS + TypeScript installation and then:

    git clone https://github.com/shah/uniform-resource.git
    cd uniform-resource
    npm install
    npm test

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
            tr.FollowRedirectsGranular.singleton,
            tr.AcquireQueryableContent.singleton)
    })
    const ctx: ur.UniformResourceContext = {
        isUniformResourceContext: true
    }

    // this method is the entrypoint for a single resource to be created from a URL
    const resource = await supplier.resourceFromAnchor(ctx, { href: "https://t.co/fDxPF" });
    if(ur.isInvalidResource(resource)) {
        // resource.error gives the reason
    } else {
        // if you care about whether the resource was followed
        if(tr.isFollowedResource(resource)) {
            // this means that the resource was successfuly "followed" (redirected)
            console.log("The final, terminated URL:", resource.uri);
            if (follow.isTextContentResult(resource.terminalResult) && 
                !follow.isTerminalTextContentResult(resource.terminalResult)) {
                // this means that the resource was "terminal" (meaning concluded properly)
                // but was not a text (or HTML) resource. Could be a 404, for example
                console.log("HTTP Status:", resource.terminalResult.httpStatus);
            }

            if (follow.isTerminalTextContentResult(resource.terminalResult)) {
                // this means that the resource was determined to be a text/HTML resource
                // good for debugging or if you need to know the source content, HTTP headers, etc.
                console.log("The HTML:", resource.content);
            }
        }
        
        // If you care about the type of content, this is only available using the 
        // AcquireQueryableContent transformer (which knows about FollowRedirectsGranular)
        if (c.isGovernedContent(resource)) {
            console.log(resource.contentType);
            console.log(resource.mimeType.essence);
        }

        // if you care about the content itself, this is only available if the 
        // AcquireQueryableContent transformer was used (which knows about FollowRedirectsGranular)
        if (ur.isUniformResourceContent(resource)) {
            console.log(resource.content.title);
            if (resource.content.socialGraph) {
                console.dir(resource.content.socialGraph);
            }
        }
    }
```