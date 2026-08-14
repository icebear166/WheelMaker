package agent

import (
	"context"
	"strings"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// modelDisplayNameInstance relabels model configOption values from the
// provider profile's curated display names. Claude-compatible gateways expose
// only tier aliases through the CLI SDK, so allowlist entries the adapter
// cannot match surface as raw model ids; the profile's staticModels carry the
// unified vendor-style names for the picker.
type modelDisplayNameInstance struct {
	Instance
	models []claudeModelEntry
}

func newModelDisplayNameInstance(base Instance, models []claudeModelEntry) Instance {
	if base == nil || len(models) == 0 {
		return base
	}
	return &modelDisplayNameInstance{Instance: base, models: models}
}

func (i *modelDisplayNameInstance) SessionNew(
	ctx context.Context,
	params protocol.SessionNewParams,
) (protocol.SessionNewResult, error) {
	result, err := i.Instance.SessionNew(ctx, params)
	if err != nil {
		return result, err
	}
	result.ConfigOptions = renameModelOptionNames(result.ConfigOptions, i.models)
	return result, nil
}

func (i *modelDisplayNameInstance) SessionLoad(
	ctx context.Context,
	params protocol.SessionLoadParams,
) (protocol.SessionLoadResult, error) {
	result, err := i.Instance.SessionLoad(ctx, params)
	if err != nil {
		return result, err
	}
	result.ConfigOptions = renameModelOptionNames(result.ConfigOptions, i.models)
	return result, nil
}

func (i *modelDisplayNameInstance) SessionSetConfigOption(
	ctx context.Context,
	params protocol.SessionSetConfigOptionParams,
) ([]protocol.ConfigOption, error) {
	options, err := i.Instance.SessionSetConfigOption(ctx, params)
	if err != nil {
		return nil, err
	}
	return renameModelOptionNames(options, i.models), nil
}

func renameModelOptionNames(options []protocol.ConfigOption, models []claudeModelEntry) []protocol.ConfigOption {
	renamed := cloneConfigOptions(options)
	for optionIndex := range renamed {
		if !strings.EqualFold(renamed[optionIndex].ID, protocol.ConfigOptionIDModel) &&
			!strings.EqualFold(renamed[optionIndex].Category, protocol.ConfigOptionCategoryModel) {
			continue
		}
		for valueIndex := range renamed[optionIndex].Options {
			if model, found := findFlickerModel(models, renamed[optionIndex].Options[valueIndex].Value); found && model.Name != "" {
				renamed[optionIndex].Options[valueIndex].Name = model.Name
			}
		}
		break
	}
	return renamed
}
