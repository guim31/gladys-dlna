// -----------------------------------------------------------------------------
// Minimal XML reader for UPnP documents.
//
// UPnP only ever exchanges small, well-formed documents (device and service
// descriptions, SOAP envelopes, DIDL-Lite metadata), so a dependency-free
// reader is enough, and it keeps the sandbox light. It deliberately ignores
// DTDs: only the five predefined entities and numeric references are decoded,
// so an entity-expansion document (the "billion laughs") stays inert.
//
// Element names are kept without their namespace prefix (`dc:title` → `title`):
// UPnP documents mix prefixes freely (`u:`, `s:`, none at all) and the local
// names never collide in the vocabularies read here.
// -----------------------------------------------------------------------------

const PREDEFINED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Decode the predefined entities and the numeric character references.
 * An unknown entity is kept as written.
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(code);
    }
    return PREDEFINED_ENTITIES[entity] ?? match;
  });
}

/** Escape a value for an XML text node or a double-quoted attribute. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function localName(qualifiedName) {
  const colon = qualifiedName.indexOf(':');
  return colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1);
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attributes[localName(match[1])] = decodeEntities(match[3] ?? match[4]);
  }
  return attributes;
}

// Index of the `>` closing a start tag, skipping the ones inside quotes.
function findTagEnd(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

// Index just past a `<!DOCTYPE ...>` declaration, internal subset included.
function skipDeclaration(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth -= 1;
    else if (text[i] === '>' && depth <= 0) return i + 1;
  }
  return text.length;
}

/**
 * Parse an XML document into a tree of `{ name, attributes, children, text }`
 * nodes, `name` being the local name. Returns the root element, or throws when
 * the document holds none.
 *
 * The reader is lenient with what real devices send (a stray closing tag, a
 * missing end tag at the end of the document) but never guesses content.
 */
export function parseXml(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const document = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [document];
  const current = () => stack[stack.length - 1];
  let i = 0;

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      current().text += decodeEntities(text.slice(i));
      break;
    }
    if (lt > i) {
      current().text += decodeEntities(text.slice(i, lt));
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      current().text += text.slice(lt + 9, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (text.startsWith('<!', lt)) {
      i = skipDeclaration(text, lt + 2);
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      const name = localName(text.slice(lt + 2, end === -1 ? text.length : end).trim());
      // Close up to the matching element; a stray end tag closes nothing.
      const index = stack.map((node) => node.name).lastIndexOf(name);
      if (index > 0) {
        stack.length = index;
      }
      i = end === -1 ? text.length : end + 1;
    } else {
      const end = findTagEnd(text, lt + 1);
      if (end === -1) {
        break;
      }
      let body = text.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) {
        body = body.slice(0, -1);
      }
      const nameMatch = body.match(/^\s*([^\s/>]+)/);
      if (nameMatch) {
        const node = {
          name: localName(nameMatch[1]),
          attributes: parseAttributes(body.slice(nameMatch[0].length)),
          children: [],
          text: '',
        };
        current().children.push(node);
        if (!selfClosing) {
          stack.push(node);
        }
      }
      i = end + 1;
    }
  }

  const root = document.children[0];
  if (!root) {
    throw new Error('Not an XML document');
  }
  return root;
}

/** First direct child named `name`, or undefined. */
export function child(node, name) {
  return node?.children.find((candidate) => candidate.name === name);
}

/** Every direct child named `name`. */
export function children(node, name) {
  return node ? node.children.filter((candidate) => candidate.name === name) : [];
}

/** Trimmed text of the first direct child named `name`, or '' when absent. */
export function childText(node, name) {
  return child(node, name)?.text.trim() ?? '';
}

/** First element named `name` anywhere below `node` (depth first). */
export function find(node, name) {
  for (const candidate of node?.children ?? []) {
    if (candidate.name === name) {
      return candidate;
    }
    const found = find(candidate, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}
