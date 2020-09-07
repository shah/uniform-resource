import * as qc from "@shah/queryable-content";
import * as tru from "@shah/traverse-urls";
import * as p from "@shah/ts-pipe";
import contentDisposition from "content-disposition";
import ft from "file-type";
import * as fs from 'fs';
import os from "os";
import path from "path";
import { Writable } from 'stream';
import url from "url";
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

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

export interface ResourceTransformerContext {
  readonly fetchTimeOut?: number;
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

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
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

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
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

export interface FollowedResource extends UniformResource {
  readonly isFollowedResource: true;
  readonly URL: url.URL;
  readonly terminalResult: tru.VisitResult;
}

export function isFollowedResource(o: any): o is FollowedResource {
  return o && "isFollowedResource" in o;
}

export interface RedirectedResource extends FollowedResource, TransformedResource {
  readonly isRedirectedResource: true;
  readonly followResults: tru.VisitResult[];
}

export function isRedirectedResource(o: any): o is RedirectedResource {
  return o && "isRedirectedResource" in o;
}

export class FollowRedirectsGranular implements UniformResourceTransformer {
  static readonly singleton = new FollowRedirectsGranular();

  constructor(readonly fetchTimeOut?: number) {
  }

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | InvalidResource | FollowedResource | RedirectedResource> {
    let result: UniformResource | InvalidResource | FollowedResource | RedirectedResource = resource;
    let traveseOptions = new tru.TypicalTraverseOptions({
      fetchTimeOut: ctx.fetchTimeOut || this.fetchTimeOut || 5000
    });
    let visitResults = await tru.traverse(resource.uri, traveseOptions);
    if (visitResults.length > 0) {
      const last = visitResults[visitResults.length - 1];
      if (tru.isTerminalResult(last)) {
        if (visitResults.length > 1) {
          result = {
            ...resource,
            pipePosition: nextTransformationPipePosition(resource),
            transformedFromUR: resource,
            remarks: "Followed, with " + visitResults.length + " results",
            isFollowedResource: true,
            isRedirectedResource: true,
            followResults: visitResults,
            uri: last.url,
            URL: new url.URL(last.url),
            terminalResult: last
          }
        } else {
          result = {
            ...resource,
            isFollowedResource: true,
            uri: last.url,
            URL: new url.URL(last.url),
            terminalResult: last
          }

        }
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

export interface ReadableContentAsyncSupplier {
  (): Promise<{ [key: string]: any }>;
}

export interface MercuryReadableContent extends UniformResource {
  readonly mercuryReadable: ReadableContentAsyncSupplier;
}

export function isMercuryReadableContent(o: any): o is MercuryReadableContent {
  return o && "mercuryReadable" in o;
}

export class EnrichMercuryReadableContent implements UniformResourceTransformer {
  static readonly singleton = new EnrichMercuryReadableContent();

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<MercuryReadableContent> {
    if (isFollowedResource(resource)) {
      const tr = resource.terminalResult;
      if (tru.isTerminalTextContentResult(tr)) {
        return {
          ...resource,
          mercuryReadable: async (): Promise<{ [key: string]: any }> => {
            const Mercury = require('@postlight/mercury-parser');
            return await Mercury.parse(resource.uri, { html: Buffer.from(tr.contentText, 'utf8') });
          },
        }
      }
    }

    return {
      ...resource,
      mercuryReadable: async (): Promise<{ [key: string]: any }> => {
        const Mercury = require('@postlight/mercury-parser');
        return await Mercury.parse(resource.uri);
      },
    }
  }
}

export interface ReadableContentSupplier {
  (): { [key: string]: any };
}

export interface MozillaReadabilityContent extends UniformResource {
  readonly mozillaReadability: ReadableContentSupplier;
}

export function isMozillaReadabilityContent(o: any): o is MozillaReadabilityContent {
  return o && "mozillaReadability" in o;
}

export class EnrichMozillaReadabilityContent implements UniformResourceTransformer {
  static readonly singleton = new EnrichMozillaReadabilityContent();

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<MozillaReadabilityContent> {
    if (isFollowedResource(resource)) {
      const tr = resource.terminalResult;
      if (tru.isTerminalTextContentResult(tr)) {
        return {
          ...resource,
          mozillaReadability: (): { [key: string]: any } => {
            const { Readability } = require('@mozilla/readability');
            const { JSDOM } = require('jsdom');
            const jd = new JSDOM(tr.contentText, { url: resource.uri })
            const reader = new Readability(jd.window.document);
            return reader.parse();
          }
        }
      }
    }

    return {
      ...resource,
      mozillaReadability: (): { [key: string]: any } => {
        const { Readability } = require('@mozilla/readability');
        const { JSDOM } = require('jsdom');
        const jd = new JSDOM(``, {
          url: resource.uri,
          includeNodeLocations: true,
        });
        const reader = new Readability(jd.window.document);
        return reader.parse();
      }
    }
  }
}

export interface DownloadAttemptResult {
  readonly isDownloadAttemptResult: true;
  readonly sizeExpected: number;
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
  readonly sizeDownloaded: number;
  readonly downloadError: Error;
}

export function isDownloadErrorResult(o: any): o is DownloadErrorResult {
  return o && "downloadError" in o;
}

export interface DownloadSuccessResult extends DownloadAttemptResult {
  readonly downloadDestPath: string;
  readonly contentDisposition?: contentDisposition.ContentDisposition;
  readonly downloadedFileStats: fs.Stats;
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

export interface DownloadIndeterminateFileResult extends DownloadSuccessResult {
  readonly unknownFileType: string;
  readonly downloadedFileStats: fs.Stats;
}

export function isDownloadIdeterminateFileResult(o: any): o is DownloadIndeterminateFileResult {
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

  writer(): Writable {
    return fs.createWriteStream(path.join(this.destPath, uuidv4()));
  }

  async finalize(_: DownloadContent, resource: FollowedResource, writer: Writable): Promise<DownloadSuccessResult | DownloadFileResult | DownloadIndeterminateFileResult> {
    const dfs = writer as fs.WriteStream;
    const downloadDestPath = dfs.path as string;
    let sizeExpected = -1;
    if (tru.isTerminalResult(resource.terminalResult)) {
      const sizeHeader = resource.terminalResult.httpResponse.headers.get("Content-Length");
      if (sizeHeader) sizeExpected = parseInt(sizeHeader);
    }
    const stats = fs.statSync(downloadDestPath);
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
          sizeExpected: sizeExpected,
          downloadedFileStats: stats,
          downloadDestPath: finalFileName,
          downloadedFileType: fileType,
          contentDisposition: cd
        }
      } else {
        return {
          isDownloadAttemptResult: true,
          downloadDestPath: downloadDestPath,
          unknownFileType: "Unable to determine type of file " + downloadDestPath,
          contentDisposition: cd,
          sizeExpected: sizeExpected,
          downloadedFileStats: stats
        }
      }
    }
    return {
      isDownloadAttemptResult: true,
      downloadDestPath: downloadDestPath,
      sizeExpected: sizeExpected,
      downloadedFileStats: stats
    }
  }
}

export class DownloadContent implements UniformResourceTransformer {
  static readonly typicalDownloader = new TypicalDownloader({ createDestPath: true });
  static readonly singleton = new DownloadContent(DownloadContent.typicalDownloader);

  constructor(readonly downloader: Downloader) {
  }

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & (DownloadSkipResult | DownloadErrorResult | DownloadSuccessResult))> {
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

export class DownloadHttpContentTypes implements UniformResourceTransformer {
  static readonly pdfsOnly = new DownloadHttpContentTypes(DownloadContent.singleton, "application/pdf");
  readonly contentTypes: string[];

  constructor(readonly wrapperDC: DownloadContent, ...contentTypes: string[]) {
    this.contentTypes = contentTypes;
  }

  async flow(ctx: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & (DownloadSkipResult | DownloadErrorResult | DownloadSuccessResult))> {
    if (isFollowedResource(resource)) {
      const visitResult = resource.terminalResult;
      if (tru.isTerminalResult(visitResult)) {
        if (this.contentTypes.find(contentType => contentType == visitResult.contentType)) {
          return this.wrapperDC.flow(ctx, resource);
        }
      }
    }
    return resource;
  }
}

export class EnrichGovernedContent implements UniformResourceTransformer {
  static readonly singleton = new EnrichGovernedContent();

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & qc.GovernedContent)> {
    let result: UniformResource | (UniformResource & qc.GovernedContent) = resource;
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

export interface FavIconSupplier {
  readonly favIconResource: UniformResource;
}

export function isFavIconSupplier(o: any): o is FavIconSupplier {
  return o && "favIconResource" in o;
}

export class FavIconResource implements UniformResourceTransformer {
  static readonly followOnly = new FavIconResource(p.pipe(FollowRedirectsGranular.singleton));
  static readonly followAndDownload = new FavIconResource(p.pipe(FollowRedirectsGranular.singleton, DownloadContent.singleton));

  constructor(readonly transformer: UniformResourceTransformer) {

  }

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | (UniformResource & FavIconSupplier)> {
    const favIconURL = new URL(resource.uri);
    favIconURL.pathname = '/favicon.ico';
    const fir = await acquireResource({
      uri: favIconURL.href,
      transformer: this.transformer,
      provenance: { provenanceURN: resource.uri },
    })
    return {
      ...resource,
      favIconResource: fir
    };
  }
}

export interface CuratableContentResource extends UniformResource {
  readonly curatableContent: qc.CuratableContent;
  readonly domainBrand: string;
}

export function isCuratableContentResource(o: any): o is CuratableContentResource {
  return o && ("curatableContent" in o);
}

export class EnrichCuratableContent implements UniformResourceTransformer {
  static readonly singleton = new EnrichCuratableContent(p.pipe(
    qc.BuildCuratableContent.singleton,
    qc.StandardizeCurationTitle.singleton));

  constructor(readonly contentTr: qc.ContentTransformer) {
  }

  async flow(_: ResourceTransformerContext, resource: UniformResource): Promise<UniformResource | CuratableContentResource> {
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
        curatableContent: content as qc.CuratableContent,
        domainBrand: resource.URL.hostname.replace(/^www\./, "")
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
    provenance: provenance || { provenanceURN: "unknown" },
    uri: uri,
    label: label
  };
  return await transformer.flow({}, result);
}
