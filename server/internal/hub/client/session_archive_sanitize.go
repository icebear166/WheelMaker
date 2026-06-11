package client

import (
	"encoding/json"
	"net/url"
	"strings"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const archiveAttachmentRemovedText = "Attachment removed during archive"

func sanitizeArchiveTurnContents(contents []string) []string {
	if len(contents) == 0 {
		return contents
	}
	sanitized := make([]string, len(contents))
	for i, content := range contents {
		sanitized[i] = sanitizeArchiveTurnContent(content)
	}
	return sanitized
}

func sanitizeArchiveTurnContent(content string) string {
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(content), &message); err != nil {
		return content
	}
	if strings.TrimSpace(message.Method) != acp.SessionTurnMethodPromptRequest || len(message.Param) == 0 {
		return content
	}

	var request acp.SessionTurnPromptRequest
	if err := json.Unmarshal(message.Param, &request); err != nil {
		return content
	}
	filtered := request.ContentBlocks[:0]
	removed := false
	for _, block := range request.ContentBlocks {
		if shouldStripArchiveContentBlock(block) {
			removed = true
			continue
		}
		filtered = append(filtered, block)
	}
	if !removed {
		return content
	}
	if len(filtered) == 0 {
		filtered = []acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: archiveAttachmentRemovedText,
		}}
	}
	request.ContentBlocks = filtered
	return buildSessionTurnContentJSON(message.Method, request)
}

func shouldStripArchiveContentBlock(block acp.ContentBlock) bool {
	switch block.Type {
	case acp.ContentBlockTypeImage:
		return true
	case acp.ContentBlockTypeResourceLink:
		parsed, err := url.Parse(strings.TrimSpace(block.URI))
		return err == nil && strings.EqualFold(parsed.Scheme, "file")
	default:
		return false
	}
}
