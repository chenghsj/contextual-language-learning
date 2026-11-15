import SwiftUI

struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(Int, String)
        case paragraph(String)
        case quote(String)
        case list(String)
        case code(String)
        case table([[String]])
    }
    let id: Int
    let kind: Kind
}

enum MarkdownParser {
    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown.components(separatedBy: .newlines)
        var blocks: [MarkdownBlock] = []
        var cursor = 0
        while cursor < lines.count {
            let start = cursor
            let line = lines[cursor]
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                cursor += 1
                continue
            }
            if line.hasPrefix("```") {
                cursor += 1
                var code: [String] = []
                while cursor < lines.count && !lines[cursor].hasPrefix("```") {
                    code.append(lines[cursor])
                    cursor += 1
                }
                if cursor < lines.count { cursor += 1 }
                blocks.append(MarkdownBlock(id: start, kind: .code(code.joined(separator: "\n"))))
                continue
            }
            if line.contains("|"), cursor + 1 < lines.count, isTableSeparator(lines[cursor + 1]) {
                var rows = [tableCells(line)]
                cursor += 2
                while cursor < lines.count && lines[cursor].contains("|")
                    && !lines[cursor].trimmingCharacters(in: .whitespaces).isEmpty
                {
                    rows.append(tableCells(lines[cursor]))
                    cursor += 1
                }
                blocks.append(MarkdownBlock(id: start, kind: .table(rows)))
                continue
            }
            let hashes = line.prefix(while: { $0 == "#" }).count
            if (1...6).contains(hashes), line.dropFirst(hashes).first == " " {
                blocks.append(
                    MarkdownBlock(
                        id: start, kind: .heading(hashes, String(line.dropFirst(hashes + 1)))))
            } else if line.hasPrefix("> ") {
                blocks.append(MarkdownBlock(id: start, kind: .quote(String(line.dropFirst(2)))))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ")
                || line.range(of: #"^\d+\. "#, options: .regularExpression) != nil
            {
                blocks.append(MarkdownBlock(id: start, kind: .list(line)))
            } else {
                blocks.append(MarkdownBlock(id: start, kind: .paragraph(line)))
            }
            cursor += 1
        }
        return blocks
    }

    static func inline(_ text: String) -> AttributedString {
        let imagesRemoved = text.replacingOccurrences(
            of: #"!\[[^\]]*\]\([^)]*\)"#, with: "〔圖片已略過〕", options: .regularExpression)
        let clean = imagesRemoved.replacingOccurrences(
            of: #"</?[A-Za-z][^>]*>"#, with: "", options: .regularExpression)
        var value =
            (try? AttributedString(
                markdown: clean, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(clean)
        for run in value.runs {
            if let url = run.link, safeSourceURL(url.absoluteString) == nil {
                value[run.range].link = nil
            }
        }
        return value
    }

    private static func tableCells(_ line: String) -> [String] {
        var value = line.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("|") { value.removeFirst() }
        if value.hasSuffix("|") { value.removeLast() }
        return value.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func isTableSeparator(_ line: String) -> Bool {
        let cells = tableCells(line)
        return !cells.isEmpty
            && cells.allSatisfy {
                $0.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil
            }
    }
}

struct SafeMarkdownView: View {
    private struct Row: Identifiable {
        let id: Int
        let cells: [Cell]
    }
    private struct Cell: Identifiable {
        let id: Int
        let text: String
    }
    private let blocks: [MarkdownBlock]
    let textScale: Double
    @ScaledMetric(relativeTo: .body) private var bodySize = 17

    init(markdown: String, textScale: Double) {
        blocks = MarkdownParser.parse(markdown)
        self.textScale = textScale
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(blocks) { block in
                switch block.kind {
                case .heading(let level, let text):
                    Text(MarkdownParser.inline(text)).font(level == 1 ? .title2.bold() : .headline)
                        .accessibilityAddTraits(.isHeader).textSelection(.enabled)
                case .paragraph(let text), .list(let text):
                    Text(MarkdownParser.inline(text)).textSelection(.enabled)
                case .quote(let text):
                    Text(MarkdownParser.inline(text)).foregroundStyle(.secondary).padding(
                        .leading, 12
                    ).overlay(alignment: .leading) {
                        Rectangle().fill(.secondary.opacity(0.4)).frame(width: 3)
                    }.textSelection(.enabled)
                case .code(let text):
                    ScrollView(.horizontal) {
                        Text(verbatim: text).font(.system(.body, design: .monospaced))
                            .textSelection(.enabled).padding(12)
                    }.background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                case .table(let values):
                    table(values)
                }
            }
        }
        .font(.system(size: bodySize * textScale))
        .environment(
            \.openURL,
            OpenURLAction { safeSourceURL($0.absoluteString) != nil ? .systemAction : .discarded })
    }

    private func table(_ values: [[String]]) -> some View {
        let rows = values.enumerated().map {
            Row(
                id: $0.offset,
                cells: $0.element.enumerated().map { Cell(id: $0.offset, text: $0.element) })
        }
        return ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                ForEach(rows) { row in
                    GridRow {
                        ForEach(row.cells) { cell in
                            Text(MarkdownParser.inline(cell.text)).fontWeight(
                                row.id == 0 ? .semibold : .regular
                            ).frame(maxWidth: 260, alignment: .leading).textSelection(.enabled)
                        }
                    }
                    if row.id == 0 { Divider().gridCellUnsizedAxes(.horizontal) }
                }
            }.padding(12)
        }.background(.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }
}
