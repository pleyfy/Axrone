import { err, ok, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from '../errors';

export interface XmlElement {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: readonly XmlElement[];
    readonly text: string;
}

const malformed = (
    message: string,
    position: number
): Result<never, TilemapAssetError> =>
    err(
        tilemapAssetError(
            TilemapAssetErrorCode.MALFORMED_SOURCE,
            message,
            { details: { position } }
        )
    );

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*/;

const decodeEntities = (value: string): string =>
    value.replace(
        /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
        (match, entity: string) => {
            switch (entity) {
                case 'amp':
                    return '&';
                case 'lt':
                    return '<';
                case 'gt':
                    return '>';
                case 'quot':
                    return '"';
                case 'apos':
                    return "'";
                default:
                    if (entity.startsWith('#x')) {
                        return String.fromCodePoint(
                            Number.parseInt(entity.slice(2), 16)
                        );
                    }
                    return String.fromCodePoint(
                        Number.parseInt(entity.slice(1), 10)
                    );
            }
        }
    );

class XmlReader {
    readonly #source: string;
    #position = 0;

    constructor(source: string) {
        this.#source = source;
    }

    get position(): number {
        return this.#position;
    }

    get done(): boolean {
        return this.#position >= this.#source.length;
    }

    peek(offset = 0): string {
        return this.#source[this.#position + offset] ?? '';
    }

    startsWith(value: string): boolean {
        return this.#source.startsWith(value, this.#position);
    }

    advance(count = 1): void {
        this.#position += count;
    }

    skipWhitespace(): void {
        while (!this.done && /\s/.test(this.peek())) this.#position++;
    }

    readUntil(terminator: string): Result<string, TilemapAssetError> {
        const index = this.#source.indexOf(terminator, this.#position);
        if (index < 0) {
            return malformed(`missing ${terminator}`, this.#position);
        }
        const value = this.#source.slice(this.#position, index);
        this.#position = index + terminator.length;
        return ok(value);
    }

    skipComment(): Result<void, TilemapAssetError> {
        const skipped = this.readUntil('-->');
        return skipped.isErr() ? err(skipped.expectErr('comment')) : ok(undefined);
    }

    skipProcessingInstruction(): Result<void, TilemapAssetError> {
        const skipped = this.readUntil('?>');
        return skipped.isErr()
            ? err(skipped.expectErr('processing instruction'))
            : ok(undefined);
    }

    skipDoctype(): Result<void, TilemapAssetError> {
        // DOCTYPE may carry an internal subset; track brackets to find the end.
        let depth = 0;
        while (!this.done) {
            const char = this.peek();
            this.advance();
            if (char === '[') depth++;
            else if (char === ']') depth = Math.max(0, depth - 1);
            else if (char === '>' && depth === 0) return ok(undefined);
        }
        return malformed('unterminated DOCTYPE', this.position);
    }

    readName(): Result<string, TilemapAssetError> {
        const match = NAME_PATTERN.exec(this.#source.slice(this.#position));
        if (!match) return malformed('expected an element name', this.position);
        this.advance(match[0].length);
        return ok(match[0]);
    }

    parseElement(): Result<XmlElement, TilemapAssetError> {
        if (this.peek() !== '<') {
            return malformed('expected <', this.position);
        }
        this.advance();
        const nameResult = this.readName();
        if (nameResult.isErr()) return err(nameResult.expectErr('name'));
        const name = nameResult.get();
        const attributes: Record<string, string> = {};
        let selfClosing = false;

        while (!this.done) {
            this.skipWhitespace();
            if (this.startsWith('/>')) {
                this.advance(2);
                selfClosing = true;
                break;
            }
            if (this.peek() === '>') {
                this.advance();
                break;
            }
            const attributeName = this.readName();
            if (attributeName.isErr()) {
                return err(attributeName.expectErr('attribute name'));
            }
            this.skipWhitespace();
            if (this.peek() !== '=') {
                return malformed('expected = after attribute name', this.position);
            }
            this.advance();
            this.skipWhitespace();
            const quote = this.peek();
            if (quote !== '"' && quote !== "'") {
                return malformed('attribute value must be quoted', this.position);
            }
            this.advance();
            const value = this.readUntil(quote);
            if (value.isErr()) return err(value.expectErr('attribute value'));
            if (attributes[attributeName.get()] !== undefined) {
                return malformed(
                    `duplicate attribute ${attributeName.get()}`,
                    this.position
                );
            }
            attributes[attributeName.get()] = decodeEntities(value.get());
        }

        if (selfClosing) {
            return ok({ name, attributes, children: [], text: '' });
        }

        const children: XmlElement[] = [];
        let text = '';
        while (!this.done) {
            if (this.startsWith('</')) {
                this.advance(2);
                const closingName = this.readName();
                if (closingName.isErr()) {
                    return err(closingName.expectErr('closing name'));
                }
                this.skipWhitespace();
                if (this.peek() !== '>') {
                    return malformed('expected > after closing tag', this.position);
                }
                this.advance();
                if (closingName.get() !== name) {
                    return malformed(
                        `mismatched closing tag: expected </${name}>, got </${closingName.get()}>`,
                        this.position
                    );
                }
                return ok({ name, attributes, children, text });
            }
            if (this.startsWith('<!--')) {
                this.advance(4);
                const skipped = this.skipComment();
                if (skipped.isErr()) return err(skipped.expectErr('comment'));
                continue;
            }
            if (this.startsWith('<![CDATA[')) {
                this.advance(9);
                const cdata = this.readUntil(']]>');
                if (cdata.isErr()) return err(cdata.expectErr('CDATA'));
                text += cdata.get();
                continue;
            }
            if (this.startsWith('<?')) {
                this.advance(2);
                const skipped = this.skipProcessingInstruction();
                if (skipped.isErr()) {
                    return err(skipped.expectErr('processing instruction'));
                }
                continue;
            }
            if (this.peek() === '<') {
                const child = this.parseElement();
                if (child.isErr()) return err(child.expectErr('child element'));
                children.push(child.get());
                continue;
            }
            const next = this.#source.indexOf('<', this.#position);
            if (next < 0) {
                text += this.#source.slice(this.#position);
                this.#position = this.#source.length;
                break;
            }
            text += decodeEntities(
                this.#source.slice(this.#position, next)
            );
            this.#position = next;
        }
        return malformed(`unterminated element <${name}>`, this.position);
    }
}

const skipProlog = (reader: XmlReader): Result<void, TilemapAssetError> => {
    while (!reader.done) {
        reader.skipWhitespace();
        if (reader.startsWith('<?')) {
            reader.advance(2);
            const skipped = reader.skipProcessingInstruction();
            if (skipped.isErr()) return err(skipped.expectErr('prolog'));
            continue;
        }
        if (reader.startsWith('<!--')) {
            reader.advance(4);
            const skipped = reader.skipComment();
            if (skipped.isErr()) return err(skipped.expectErr('prolog comment'));
            continue;
        }
        if (reader.startsWith('<!DOCTYPE')) {
            reader.advance(9);
            const skipped = reader.skipDoctype();
            if (skipped.isErr()) return err(skipped.expectErr('doctype'));
            continue;
        }
        break;
    }
    return ok(undefined);
};

/** Minimal, dependency-free XML reader for TMX/TSX sources. */
export const parseXml = (
    source: string
): Result<XmlElement, TilemapAssetError> => {
    if (typeof source !== 'string' || source.length === 0) {
        return malformed('XML source must be a non-empty string', 0);
    }
    const reader = new XmlReader(source.replace(/^\uFEFF/, ''));
    const prolog = skipProlog(reader);
    if (prolog.isErr()) return err(prolog.expectErr('prolog'));
    if (reader.done || reader.peek() !== '<') {
        return malformed('XML document has no root element', reader.position);
    }
    const root = reader.parseElement();
    if (root.isErr()) return err(root.expectErr('root'));
    reader.skipWhitespace();
    if (!reader.done) {
        return malformed('trailing content after root element', reader.position);
    }
    return ok(root.get());
};

export const childElements = (
    element: XmlElement,
    name?: string
): readonly XmlElement[] =>
    name === undefined
        ? element.children
        : element.children.filter((child) => child.name === name);

export const firstChild = (
    element: XmlElement,
    name: string
): XmlElement | undefined =>
    element.children.find((child) => child.name === name);

export const attribute = (
    element: XmlElement,
    name: string
): string | undefined => element.attributes[name];

export const requiredAttribute = (
    element: XmlElement,
    name: string
): Result<string, TilemapAssetError> => {
    const value = element.attributes[name];
    if (value === undefined || value.length === 0) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                `element <${element.name}> is missing the ${name} attribute`,
                { details: { element: element.name, attribute: name } }
            )
        );
    }
    return ok(value);
};

export const integerAttribute = (
    element: XmlElement,
    name: string,
    fallback?: number
): Result<number, TilemapAssetError> => {
    const raw = element.attributes[name];
    if (raw === undefined) {
        if (fallback !== undefined) return ok(fallback);
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                `element <${element.name}> is missing the ${name} attribute`,
                { details: { element: element.name, attribute: name } }
            )
        );
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                `element <${element.name}> attribute ${name} must be an integer`,
                { details: { element: element.name, attribute: name, value: raw } }
            )
        );
    }
    return ok(value);
};

export const booleanProperty = (value: string): boolean =>
    value === 'true' || value === '1';
