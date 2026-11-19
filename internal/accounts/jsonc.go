package accounts

import "encoding/json"

func stripJSONC(src []byte) []byte {
	out := make([]byte, 0, len(src))
	i := 0
	for i < len(src) {
		if src[i] == '"' {
			out = append(out, src[i])
			i++
			for i < len(src) {
				out = append(out, src[i])
				if src[i] == '\\' {
					i++
					if i < len(src) {
						out = append(out, src[i])
					}
				} else if src[i] == '"' {
					i++
					break
				}
				i++
			}
			continue
		}
		if i+1 < len(src) && src[i] == '/' && src[i+1] == '/' {
			for i < len(src) && src[i] != '\n' {
				i++
			}
			if i < len(src) {
				out = append(out, '\n')
				i++
			}
			continue
		}
		if i+1 < len(src) && src[i] == '/' && src[i+1] == '*' {
			i += 2
			for i+1 < len(src) {
				if src[i] == '*' && src[i+1] == '/' {
					i += 2
					break
				}
				i++
			}
			continue
		}
		out = append(out, src[i])
		i++
	}

	out = removeTrailingCommas(out)
	return out
}

func removeTrailingCommas(src []byte) []byte {
	out := make([]byte, 0, len(src))
	for i := 0; i < len(src); i++ {
		if src[i] == '"' {
			out = append(out, src[i])
			i++
			for i < len(src) {
				out = append(out, src[i])
				if src[i] == '\\' {
					i++
					if i < len(src) {
						out = append(out, src[i])
					}
				} else if src[i] == '"' {
					break
				}
				i++
			}
			continue
		}
		if src[i] == ',' {
			j := i + 1
			for j < len(src) && (src[j] == ' ' || src[j] == '\t' || src[j] == '\r' || src[j] == '\n') {
				j++
			}
			if j < len(src) && (src[j] == '}' || src[j] == ']') {
				continue
			}
		}
		out = append(out, src[i])
	}
	return out
}

func UnmarshalJSONC(data []byte, v any) error {
	clean := stripJSONC(data)
	return json.Unmarshal(clean, v)
}
