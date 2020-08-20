import * as tru from "@shah/traverse-urls";
import { Cache, lruCache } from "@shah/ts-cache";
import * as p from "@shah/ts-pipe";
import cheerio from "cheerio";
import * as fs from 'fs';
import { Writable } from 'stream';
import * as util from 'util';
import mime from "whatwg-mimetype";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from 'uuid';
import ft from "file-type";
import contentDisposition from "content-disposition";

const streamPipeline = util.promisify(require('stream').pipeline);

/*******************************
 * Uniform resource governance *
 *******************************/

export type UniformResourceIdentifier = string;
export type UniformResourceLabel = string;
export type UniformResourceName = string;
export type DigitalObjectIdentifier = string;

export interface UniformResourceProvenance {
  readonly provenanceURN: UniformResourceName;
}

// NOTE: for all UniformResource and related interfaces be careful using functions
// (unless the functions are properties) because the spread operator is used for copying
// of resource instances often (especially in resource transfomers).

export interface UniformResource {
  readonly isUniformResource: true;
  readonly provenance: UniformResourceProvenance;
  readonly uri: UniformResourceIdentifier;
  readonly doi?: DigitalObjectIdentifier;
  readonly label?: UniformResourceLabel;
}

export function isUniformResource(o: any): o is UniformResource {
  return o && "isUniformResource" in o;
}

export interface InvalidResource extends UniformResource {
  readonly isInvalidResource: true;
  readonly error: Error;
  readonly remarks?: string;
}

export function isInvalidResource(o: any): o is InvalidResource {
  return o && "isInvalidResource" in o;
}

/**********************
 * Content governance *
 **********************/

export type ContentBody = string;
export type ContentTitle = string;
export type ContentAbstract = string;

// NOTE: for all GovernedContent and related interfaces be careful using functions
// (unless the functions are properties) because the spread operator is used for copying
// of contents often (especially in content transfomers).

export interface GovernedContent {
  readonly contentType: string;
  readonly mimeType: mime;
}

export function isGovernedContent(o: any): o is GovernedContent {
  return o && ("contentType" in o) && ("mimeType" in o);
}

export interface GovernedContentContext {
  readonly uri: string;
  readonly htmlSource: string;
}

export interface HtmlAnchor {
  readonly href: string;
  readonly label?: string;
}

export interface AnchorFilter {
  (retain: HtmlAnchor): boolean;
}

export interface CuratableContent extends GovernedContent {
  readonly title: ContentTitle;
  readonly socialGraph: SocialGraph;
}

export function isCuratableContent(o: any): o is CuratableContent {
  return o && "title" in o && "socialGraph" in o;
}

export interface QueryableHtmlContent extends GovernedContent {
  readonly htmlSource: string;
  readonly document: CheerioStatic;
  readonly anchors: (retain?: AnchorFilter) => HtmlAnchor[];
}

export function isQueryableHtmlContent(o: any): o is QueryableHtmlContent {
  return o && "htmlSource" in o && "document" in o;
}

export interface OpenGraph {
  type?: string;
  title?: ContentTitle;
  description?: ContentAbstract;
  imageURL?: string;
}

export interface TwitterCard {
  title?: ContentTitle;
  description?: ContentAbstract;
  imageURL?: string;
  site?: string;
  creator?: string;
}

export interface SocialGraph {
  readonly openGraph?: Readonly<OpenGraph>;
  readonly twitter?: Readonly<TwitterCard>;
}

export interface TransformedContent extends GovernedContent {
  readonly transformedFromContent: GovernedContent;
  readonly pipePosition: number;
  readonly remarks?: string;
}

export function isTransformedContent(o: any): o is TransformedContent {
  return o && "transformedFromContent" in o;
}

/************************
 * Content transformers *
 ************************/

export interface ContentTransformer extends p.PipeUnion<GovernedContentContext, GovernedContent> {
}

export class EnrichQueryableHtmlContent implements ContentTransformer {
  static readonly singleton = new EnrichQueryableHtmlContent();

  async flow(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | QueryableHtmlContent> {
    if (isQueryableHtmlContent(content)) {
      // it's already queryable so don't touch it
      return content;
    }

    // enrich the existing content with cheerio static document
    const document = cheerio.load(ctx.htmlSource, {
      normalizeWhitespace: true,
      decodeEntities: true,
    })
    return {
      ...content,
      htmlSource: ctx.htmlSource,
      document: document,
      anchors: (retain?: AnchorFilter): HtmlAnchor[] => {
        const result: HtmlAnchor[] = []
        document("a").each((index, anchorTag): void => {
          const href = anchorTag.attribs["href"];
          if (href) {
            const anchor: HtmlAnchor = {
              href: href,
              label: document(anchorTag).text()
            }
            if (retain) {
              if (retain(anchor)) result.push(anchor);
            } else {
              result.push(anchor);
            }
          }
        });
        return result;
      }
    };
  }
}

export class BuildCuratableContent implements ContentTransformer {
  static readonly singleton = new BuildCuratableContent();

  parseSocialGraph(ctx: GovernedContentContext, document: CheerioStatic): SocialGraph {
    let og: OpenGraph = {};
    let tc: TwitterCard = {};
    const metaTransformers: {
      [key: string]: (v: string) => void;
    } = {
      'og:type': (v: string) => { og.type = v },
      'og:title': (v: string) => { og.title = v },
      'og:description': (v: string) => { og.description = v },
      'og:image': (v: string) => { og.imageURL = v },
      'twitter:title': (v: string) => { tc.title = v },
      'twitter:image': (v: string) => { tc.imageURL = v },
      'twitter:description': (v: string) => { tc.description = v },
      'twitter:site': (v: string) => { tc.site = v },
      'twitter:creator': (v: string) => { tc.creator = v },
    };
    const meta = document('meta') as any;
    const keys = Object.keys(meta);
    for (const outerKey in metaTransformers) {
      keys.forEach(function (innerKey) {
        if (meta[innerKey].attribs
          && meta[innerKey].attribs.property
          && meta[innerKey].attribs.property === outerKey) {
          metaTransformers[outerKey](meta[innerKey].attribs.content);
        }
      })
    }
    const result: { [key: string]: any } = {};
    if (Object.keys(og).length > 0) result.openGraph = og;
    if (Object.keys(tc).length > 0) result.twitter = tc;
    return result as SocialGraph;
  }

  title(ctx: GovernedContentContext, document: CheerioStatic, sg?: SocialGraph): string {
    // If an og:title is available, use it otherwise use twitter:title otherwise use page title
    const socialGraph = sg ? sg : this.parseSocialGraph(ctx, document);
    let result = document('head > title').text();
    if (socialGraph.twitter?.title)
      result = socialGraph.twitter.title;
    if (socialGraph.openGraph?.title)
      result = socialGraph.openGraph.title;
    return result;
  }

  async flow(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | CuratableContent> {
    let result: GovernedContent | QueryableHtmlContent = content;
    if (!isQueryableHtmlContent(result)) {
      // first make it queryable
      result = await EnrichQueryableHtmlContent.singleton.flow(ctx, result);
    }

    if (isQueryableHtmlContent(result)) {
      const socialGraph = this.parseSocialGraph(ctx, result.document)
      return {
        ...result,
        title: this.title(ctx, result.document, socialGraph),
        socialGraph: socialGraph
      };
    } else {
      console.error("[EnrichCuratableContent.transform()] This should never happen!")
      return content;
    }
  }
}

export class StandardizeCurationTitle implements ContentTransformer {
  // RegEx matches " | Healthcare IT News" from a title like "xyz title | Healthcare IT News"
  static readonly sourceNameAfterPipeRegEx = / \| .*$/;
  static readonly singleton = new StandardizeCurationTitle();

  async flow(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | CuratableContent | TransformedContent> {
    if (isCuratableContent(content)) {
      const suggested = content.title;
      const standardized = suggested.replace(StandardizeCurationTitle.sourceNameAfterPipeRegEx, "");
      if (suggested != standardized) {
        return {
          ...content,
          title: standardized,
          transformedFromContent: content,
          pipePosition: nextTransformationPipePosition(content),
          remarks: `Standardized title (was "${suggested}")`
        }
      }
    }
    return content;
  }
}

export interface ReadableContentAsyncSupplier {
  (): Promise<{ [key: string]: any }>;
}

export interface MercuryReadableContent extends GovernedContent {
  readonly mercuryReadable: ReadableContentAsyncSupplier;
}

export function isMercuryReadableContent(o: any): o is MercuryReadableContent {
  return o && "mercuryReadable" in o;
}

export class EnrichMercuryReadableContent implements ContentTransformer {
  static readonly singleton = new EnrichMercuryReadableContent();

  async flow(ctx: GovernedContentContext, content: GovernedContent): Promise<MercuryReadableContent> {
    return {
      ...content,
      mercuryReadable: async (): Promise<{ [key: string]: any }> => {
        const Mercury = require('@postlight/mercury-parser');
        return await Mercury.parse(ctx.uri, { html: Buffer.from(ctx.htmlSource, 'utf8') });
      },
    }
  }
}

export interface ReadableContentSupplier {
  (): { [key: string]: any };
}

export interface MozillaReadabilityContent extends GovernedContent {
  readonly mozillaReadability: ReadableContentSupplier;
}

export function isMozillaReadabilityContent(o: any): o is MozillaReadabilityContent {
  return o && "mozillaReadability" in o;
}

export class EnrichMozillaReadabilityContent implements ContentTransformer {
  static readonly singleton = new EnrichMozillaReadabilityContent();

  async flow(ctx: GovernedContentContext, content: GovernedContent): Promise<MozillaReadabilityContent> {
    return {
      ...content,
      mozillaReadability: (): { [key: string]: any } => {
        const { Readability } = require('@mozilla/readability');
        const { JSDOM } = require('jsdom');
        const jd = new JSDOM(ctx.htmlSource, { url: ctx.uri })
        const reader = new Readability(jd.window.document);
        return reader.parse();
      }
    }
  }
}

/************************************
 * Uniform resource transformations *
 ************************************/

export interface ResourceTransformerContext {

}

export interface TransformedResource extends UniformResource {
  readonly transformedFromUR: UniformResource;
  readonly pipePosition: number;
  readonly remarks?: string;
}

export function isTransformedResource(o: any): o is TransformedResource {
  return o && "transformedFromUR" in o && "pipePosition" in o;
}

export function nextTransformationPipePosition(o: any): number {
  return "pipePosition" in o ? o.pipePosition + 1 : 0;
}

export function allTransformationRemarks(tr: TransformedResource): string[] {
  const result: string[] = [];
  let active: UniformResource = tr;
  while (isTransformedResource(active)) {
    result.unshift(active.remarks || "(no remarks)");
    active = active.transformedFromUR;
  }
  return result;
}

export interface UniformResourceTransformer extends p.PipeUnion<ResourceTransformerContext, UniformResource> {
}

export class RemoveLabelLineBreaksAndTrimSpaces implements UniformResourceTransformer {
  static readonly singleton = new RemoveLabelLineBreaksAndTrimSpaces();

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
    if (!resource.label) {
      return resource;
    }

    const cleanLabel = resource.label.replace(/\r\n|\n|\r/gm, " ").trim()
    if (cleanLabel != resource.label) {
      return {
        ...resource,
        pipePosition: nextTransformationPipePosition(resource),
        transformedFromUR: resource,
        label: cleanLabel,
        remarks: "Removed line breaks and trimmed spaces in label"
      }
    }
    return resource;
  }
}

export class RemoveTrackingCodesFromUrl implements UniformResourceTransformer {
  static readonly singleton = new RemoveTrackingCodesFromUrl();

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
    const cleanedURI = resource.uri.replace(/(?<=&|\?)utm_.*?(&|$)/igm, "");
    if (cleanedURI != resource.uri) {
      const transformed: TransformedResource = {
        ...resource,
        pipePosition: nextTransformationPipePosition(resource),
        transformedFromUR: resource,
        remarks: "Removed utm_* tracking parameters from URL",
      }
      return transformed;
    } else {
      return resource;
    }
  }
}

export interface FollowedResource extends TransformedResource {
  readonly isFollowedResource: true;
  readonly terminalResult: tru.VisitResult;
  readonly followResults: tru.VisitResult[];
}

export function isFollowedResource(o: any): o is FollowedResource {
  return o && "isFollowedResource" in o;
}

export class FollowRedirectsGranular implements UniformResourceTransformer {
  static readonly singleton = new FollowRedirectsGranular();

  constructor(readonly cache: Cache<tru.VisitResult[]> = lruCache()) {
  }

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | InvalidResource | FollowedResource> {
    let result: UniformResource | InvalidResource | FollowedResource = resource;
    let visitResults = this.cache[resource.uri];
    if (!visitResults) {
      visitResults = await tru.traverse(resource.uri);
      this.cache[resource.uri] = visitResults;
    }
    if (visitResults.length > 0) {
      const last = visitResults[visitResults.length - 1];
      if (tru.isTerminalResult(last)) {
        result = {
          ...resource,
          pipePosition: nextTransformationPipePosition(resource),
          transformedFromUR: resource,
          remarks: "Followed, with " + visitResults.length + " results",
          isFollowedResource: true,
          followResults: visitResults,
          uri: last.url,
          terminalResult: last
        };
      } else if (tru.isVisitError(last)) {
        result = {
          isInvalidResource: true,
          ...resource,
          error: last.error,
          remarks: last.error.message
        }
      }
    }
    return result;
  }
}

export interface DownloadAttemptResult {
  readonly isDownloadAttemptResult: true;
}

export function isDownloadAttemptResult(o: any): o is DownloadAttemptResult {
  return o && "isDownloadAttemptResult" in o;
}

export interface DownloadSkipResult extends DownloadAttemptResult {
  readonly downloadSkippedReason: string;
}

export function isDownloadSkipResult(o: any): o is DownloadSkipResult {
  return o && "downloadSkippedReason" in o;
}

export interface DownloadErrorResult extends DownloadAttemptResult {
  readonly downloadError: Error;
}

export function isDownloadErrorResult(o: any): o is DownloadErrorResult {
  return o && "downloadError" in o;
}

export interface DownloadSuccessResult extends DownloadAttemptResult {
  readonly downloadDestPath: string;
  readonly contentDisposition?: contentDisposition.ContentDisposition;
}

export function isDownloadSuccessResult(o: any): o is DownloadSuccessResult {
  return o && "downloadDestPath" in o;
}

export interface DownloadFileResult extends DownloadSuccessResult {
  readonly downloadedFileType: ft.FileTypeResult;
}

export function isDownloadFileResult(o: any): o is DownloadFileResult {
  return o && "downloadDestPath" in o && "downloadedFileType" in o;
}

export interface DownloadIdeterminateFileResult extends DownloadSuccessResult {
  readonly unknownFileType: string;
}

export function isDownloadIdeterminateFileResult(o: any): o is DownloadIdeterminateFileResult {
  return o && "unknownFileType" in o && "downloadedFileType" in o;
}

export interface Downloader {
  writer(dc: DownloadContent, resource: FollowedResource): Writable;
  finalize(dc: DownloadContent, resource: FollowedResource, writer: Writable): Promise<DownloadSuccessResult>;
}

export interface TypicalDownloaderOptions {
  readonly destPath?: string;
  readonly createDestPath?: boolean;
  readonly determineFileType?: boolean;
}

export class TypicalDownloader implements Downloader, TypicalDownloaderOptions {
  readonly destPath: string;
  readonly determineFileType: boolean;

  constructor({ destPath, createDestPath, determineFileType }: TypicalDownloaderOptions) {
    this.destPath = destPath || path.join(os.tmpdir(), "uniform-resource-downloads");
    this.determineFileType = typeof determineFileType == "undefined" ? true : determineFileType;
    if (createDestPath) {
      try {
        fs.mkdirSync(this.destPath);
      } catch (e) {
        // the directory already exists?
        // TODO: add error checking
      }
    }
  }

  writer(dc: DownloadContent, resource: FollowedResource): Writable {
    return fs.createWriteStream(path.join(this.destPath, uuidv4()));
  }

  async finalize(dc: DownloadContent, resource: FollowedResource, writer: Writable): Promise<DownloadSuccessResult | DownloadFileResult | DownloadIdeterminateFileResult> {
    const dfs = writer as fs.WriteStream;
    const downloadDestPath = dfs.path as string;
    if (this.determineFileType) {
      let cd: contentDisposition.ContentDisposition | undefined = undefined;
      if (tru.isTerminalResult(resource.terminalResult)) {
        const cdHeader = resource.terminalResult.httpResponse.headers.get("Content-Disposition");
        if (cdHeader) {
          cd = contentDisposition.parse(cdHeader);
        }
      }
      const fileType = await ft.fromFile(downloadDestPath);
      if (fileType) {
        const finalFileName = dfs.path + "." + fileType.ext;
        fs.renameSync(downloadDestPath, finalFileName);
        return {
          isDownloadAttemptResult: true,
          downloadDestPath: finalFileName,
          downloadedFileType: fileType,
          contentDisposition: cd
        }
      } else {
        return {
          isDownloadAttemptResult: true,
          downloadDestPath: downloadDestPath,
          unknownFileType: "Unable to determine type of file " + downloadDestPath,
          contentDisposition: cd
        }
      }
    }
    return {
      isDownloadAttemptResult: true,
      downloadDestPath: downloadDestPath
    }
  }
}

export class DownloadContent implements UniformResourceTransformer {
  static readonly typicalDownloader = new TypicalDownloader({ createDestPath: true });
  static readonly singleton = new DownloadContent(DownloadContent.typicalDownloader);

  constructor(readonly downloader: Downloader) {
  }

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & (DownloadSkipResult | DownloadErrorResult | DownloadSuccessResult))> {
    if (isFollowedResource(resource)) {
      if (tru.isTerminalResult(resource.terminalResult)) {
        try {
          const writer = this.downloader.writer(this, resource);
          if (tru.isTerminalTextContentResult(resource.terminalResult)) {
            writer.write(resource.terminalResult.contentText);
          } else {
            await streamPipeline(resource.terminalResult.httpResponse.body, writer);
          }
          const success = await this.downloader.finalize(this, resource, writer);
          return {
            ...resource,
            ...success
          }
        } catch (e) {
          return {
            ...resource,
            downloadError: e
          }
        }
      }
    }
    return {
      ...resource,
      isDownloadAttemptResult: true,
      downloadSkippedReason: `Unable to download, resource [${resource.label}](${resource.uri}) was not traversed`,
    };
  }
}

export class EnrichGovernedContent implements UniformResourceTransformer {
  static readonly singleton = new EnrichGovernedContent();

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & GovernedContent)> {
    let result: UniformResource | (UniformResource & GovernedContent) = resource;
    if (isFollowedResource(resource) && tru.isTerminalTextContentResult(resource.terminalResult)) {
      const textResult = resource.terminalResult;
      result = {
        ...resource,
        contentType: textResult.contentType,
        mimeType: textResult.mimeType
      };
    }
    return result;
  }
}

export interface CuratableContentResource extends UniformResource {
  readonly curatableContent: CuratableContent;
}

export function isCuratableContentResource(o: any): o is CuratableContentResource {
  return o && ("curatableContent" in o);
}

export class EnrichCuratableContent implements UniformResourceTransformer {
  static readonly standard = new EnrichCuratableContent(p.pipe(
    BuildCuratableContent.singleton,
    StandardizeCurationTitle.singleton));
  static readonly readable = new EnrichCuratableContent(p.pipe(
    BuildCuratableContent.singleton,
    StandardizeCurationTitle.singleton,
    EnrichMercuryReadableContent.singleton,
    EnrichMozillaReadabilityContent.singleton));

  constructor(readonly contentTr: ContentTransformer) {
  }

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | CuratableContentResource> {
    let result: UniformResource | CuratableContentResource = resource;
    if (isFollowedResource(resource) && tru.isTerminalTextContentResult(resource.terminalResult)) {
      const textResult = resource.terminalResult;
      const content = await this.contentTr.flow({
        uri: resource.uri,
        htmlSource: textResult.contentText
      }, {
        contentType: textResult.contentType,
        mimeType: textResult.mimeType
      });
      result = {
        ...resource,
        curatableContent: content as CuratableContent,
      };
    }
    return result;
  }
}

export interface AcquireResourceOptions {
  uri: UniformResourceIdentifier;
  label?: UniformResourceLabel;
  transformer: UniformResourceTransformer;
  provenance?: UniformResourceProvenance;
}

export async function acquireResource({ uri, label, provenance, transformer }: AcquireResourceOptions): Promise<UniformResource> {
  let result: UniformResource = {
    isUniformResource: true,
    provenance: provenance || { provenanceURN: "unkown" },
    uri: uri,
    label: label
  };
  return await transformer.flow({}, result);
}