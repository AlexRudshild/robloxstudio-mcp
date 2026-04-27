export type ToolCategory = 'read' | 'write';
export type ToolFeature =
  | 'core'
  | 'meta'
  | 'inspection_plus'
  | 'scripting_plus'
  | 'mutation_plus'
  | 'metadata'
  | 'builds'
  | 'assets'
  | 'playtest'
  | 'capture';

export interface ToolDefinition {
  name: string;
  /** Short description shipped in tool list. Keep concise (≤2 sentences, ≤200 chars when possible). */
  description: string;
  /** Optional extended description with workflow chains, examples, edge cases. Available on demand via get_tool_help. */
  descriptionLong?: string;
  category: ToolCategory;
  /** Feature group. Omit = 'core' (always loaded). */
  feature?: ToolFeature;
  inputSchema: object;
}

export function getToolFeature(t: ToolDefinition): ToolFeature {
  return t.feature ?? 'core';
}

export interface FeatureDescriptor {
  name: ToolFeature;
  description: string;
  alwaysOn: boolean;
}

export const FEATURE_DESCRIPTORS: FeatureDescriptor[] = [
  { name: 'core', description: 'Core inspection, mutation, scripting (always loaded)', alwaysOn: true },
  { name: 'meta', description: 'Meta-tools to discover and load other features (always loaded)', alwaysOn: true },
  { name: 'inspection_plus', description: 'Extended inspection: descendants traversal, mass property reads, class info, instance comparison, output log', alwaysOn: false },
  { name: 'scripting_plus', description: 'Extended script editing: insert/delete lines, syntax analysis, project-wide find/replace', alwaysOn: false },
  { name: 'mutation_plus', description: 'Bulk creation and duplication: mass_create_objects, smart/mass duplicate, redo, create_ui_tree', alwaysOn: false },
  { name: 'metadata', description: 'Attributes and CollectionService tags', alwaysOn: false },
  { name: 'builds', description: 'Build library: procedurally generate, export, import builds and scenes; material search', alwaysOn: false },
  { name: 'assets', description: 'Roblox marketplace: search assets, get details, insert, upload decals', alwaysOn: false },
  { name: 'playtest', description: 'Run/stop playtests and read playtest output', alwaysOn: false },
  { name: 'capture', description: 'Screenshots, simulated mouse/keyboard input, character pathfinding', alwaysOn: false },
];

export const ALWAYS_ON_FEATURES: ToolFeature[] = FEATURE_DESCRIPTORS.filter(f => f.alwaysOn).map(f => f.name);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // === Meta (always loaded) ===
  {
    name: 'list_features',
    category: 'read',
    feature: 'meta',
    description: 'List loadable feature blocks with enabled state. Call when needed tool is missing from list. Triggers: attributes/tags (metadata), mass ops (mutation_plus), syntax check (scripting_plus), descendants/output (inspection_plus), playtest, capture, builds, assets. Then enable_feature.',
    descriptionLong: 'List loadable feature blocks with descriptions and current enabled state. Call this when you need a tool that is not in your current tool list — common triggers: attributes/tags (metadata), mass operations on many instances (mutation_plus), project-wide find/replace or syntax check (scripting_plus), descendants/output log (inspection_plus), playtest (playtest), screenshots/input simulation (capture), build library (builds), marketplace assets (assets). Then call enable_feature to activate.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'enable_feature',
    category: 'read',
    feature: 'meta',
    description: 'Activate a feature block so its tools become available. After this returns, re-list tools (the client will refresh automatically) and call the new tool on your NEXT turn — same-turn calls may race the refresh. Pass a single name or an array.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ],
          description: 'Feature name or array of names (e.g. "builds", ["playtest","capture"])'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'get_tool_help',
    category: 'read',
    feature: 'meta',
    description: 'Get extended help for a tool: workflow chains, examples, edge cases, value-format details. Tool descriptions are kept short by default; call this for the full prose when you need deeper guidance on a specific tool.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Tool name to look up (e.g. "edit_script_lines")'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'disable_feature',
    category: 'read',
    feature: 'meta',
    description: 'Deactivate a feature block to free LLM context. core and meta cannot be disabled.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ],
          description: 'Feature name or array of names'
        }
      },
      required: ['name']
    }
  },

  // === File & Instance Browsing ===

  // === Place & Service Info ===
  {
    name: 'get_place_info',
    category: 'read',
    description: 'Get place ID, name, and game settings',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_services',
    category: 'read',
    description: 'Get available services and their children',
    inputSchema: {
      type: 'object',
      properties: {
        serviceName: {
          type: 'string',
          description: 'Specific service name'
        }
      }
    }
  },
  {
    name: 'search',
    category: 'read',
    description: 'Find instances. searchType: "name" (substring on Name), "class" (substring on ClassName), "property" (matches query against tostring(instance[propertyName]); requires propertyName), "content" (substring on script source — for richer code search prefer grep_scripts). Default: "name".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring to match (or property value when searchType is "property")'
        },
        searchType: {
          type: 'string',
          enum: ['name', 'class', 'property', 'content'],
          description: 'Search mode (default: name)'
        },
        propertyName: {
          type: 'string',
          description: 'Property name (required when searchType is "property")'
        }
      },
      required: ['query']
    }
  },

  // === Instance Inspection ===
  {
    name: 'get_instance_properties',
    category: 'read',
    description: 'Get built-in Roblox properties. mode="delta" (default, non-defaults only) or "full". Vector3/Color3/UDim2/CFrame returned as typed objects. Custom user data: use get_attributes/get_tags (metadata feature). Supports knownHash.',
    descriptionLong: `Get instance built-in Roblox properties (Position, Size, Color, RunContext for scripts, etc.).
MODE: "delta" (default) returns only non-default values + omittedDefaultCount; "full" returns every readable property. Properties whose read pcall fails are silently skipped in both modes (no nil entries — absence means unreadable or default).
PATH: dot notation only (game.Workspace.MyPart). Names containing dots are not addressable. Parent serializes as path string ("nil" if orphaned).
COMPLEX TYPES: returned as objects with _type tag — Vector3 {X,Y,Z,_type:"Vector3"}, Color3 {R,G,B,_type:"Color3"} (0-1 range), UDim2 {X:{Scale,Offset},Y:{Scale,Offset},_type:"UDim2"}, CFrame {Position:{X,Y,Z},Rotation:[r00..r22],_type:"CFrame"}, EnumItem {Name,EnumType,Value,_type:"EnumItem"}, Instance {Path,_type:"Instance"}, NumberRange/Rect similar. BrickColor not in default output (auto-derives from Color3, legacy) — to set it explicitly pass a name string ("Bright red") via set_property.
HASH: pass knownHash from prior call to dedup unchanged data — server returns {unchanged:true,knownHash}. After any write (set_property, edit_script_lines, etc.) the new hash differs naturally; the response of those write tools includes the new knownHash to chain forward.
NOT for custom user data — use get_attributes / get_tags (metadata feature).`,
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        excludeSource: {
          type: 'boolean',
          description: 'For scripts, return SourceLength/LineCount instead of full source (default: false)'
        },
        mode: {
          type: 'string',
          enum: ['delta', 'full'],
          description: 'delta = only non-defaults (default); full = include all properties'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response of this tool to dedup unchanged data — server returns {unchanged:true,knownHash}.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'get_instance_children',
    category: 'read',
    description: 'Get DIRECT children (one level only) and their class types. For full recursive traversal use get_descendants (inspection_plus feature). For overview tree use get_project_structure. Supports knownHash.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response of this tool to dedup unchanged data — server returns {unchanged:true,knownHash}.'
        }
      },
      required: ['instancePath']
    }
  },
  // === Project Structure ===
  {
    name: 'get_project_structure',
    category: 'read',
    description: 'Get game hierarchy as nested tree (default depth 3). For one level only use get_instance_children (cheaper). For flat recursive list use get_descendants (inspection_plus). For finding by name/class use search. Increase maxDepth for deeper traversal. Pass knownHash to dedup unchanged trees.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Root instance path (dot notation, e.g. "game.Workspace"). Default: service overview.'
        },
        maxDepth: {
          type: 'number',
          description: 'Max traversal depth (default: 3)'
        },
        scriptsOnly: {
          type: 'boolean',
          description: 'Show only scripts (default: false)'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response to dedup unchanged trees — server returns {unchanged:true,knownHash}.'
        }
      }
    }
  },

  // === Property Write ===
  {
    name: 'set_property',
    category: 'write',
    description: 'Set ONE built-in property on ONE instance. Many props on one inst: set_properties. One prop on many: mass_set_property (mutation_plus). Custom data: set_attribute (metadata). Call get_tool_help for value formats.',
    descriptionLong: `Set ONE built-in Roblox property on ONE instance. For many props on one instance use set_properties; for one prop on many instances use mass_set_property (mutation_plus); for custom user data use set_attribute (metadata).
PATH: dot notation only (no bracket-escape).
INPUT VALUE FORMATS (auto-coerced to Roblox types):
  Vector3 — array [x,y,z] (for Position/Size/Orientation/Velocity/AngularVelocity, or any property whose current value is Vector3) OR object {X,Y,Z}
  Vector2 — array [x,y] (auto-detected by current type)
  Color3 — array [r,g,b] 0-1 range (for Color/Color3 props) OR object {R,G,B}
  UDim2 — array [xScale,xOffset,yScale,yOffset] (auto-detected) OR {X:{Scale,Offset},Y:{Scale,Offset}}
  Enum — short name string ("Plastic" sets Material to Enum.Material.Plastic)
  BrickColor — name string ("Bright red") or numeric ID
  Instance ref — dot-path string, but ONLY for Parent and PrimaryPart (other ref props like Adornee/SoundGroup will fail — set those by writing the resolved instance via execute_luau)
  Booleans — bool, or strings "true"/"false"
OUTPUT FORMAT differs (see get_instance_properties): complex types come back as objects with _type tag.
ERRORS: instance_not_found (bad path), ref_not_found (Parent/PrimaryPart target missing), property_write_failed (read-only, missing on class, or wrong type).`,
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        },
        propertyValue: {
          description: 'Value to set (string, number, boolean, or object for Vector3/Color3/UDim2)'
        }
      },
      required: ['instancePath', 'propertyName', 'propertyValue']
    }
  },
  {
    name: 'mass_set_property',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Set ONE property on MANY instances (one prop, N instances). For many props on one instance use set_properties. For single edit use set_property. Returns per-item success/error array (not atomic).',
    descriptionLong: `Set ONE built-in property on MANY instances. NOT atomic — each path is processed independently; failures DO NOT roll back successes. Response: results[]:{path,success,...} plus summary:{total,succeeded,failed}. Inspect summary.failed before assuming the whole batch worked.
Same value coercion rules as set_property (Vector3 array [x,y,z], Color3 [r,g,b], Enum short name, Parent/PrimaryPart as dot-path string, etc.). Per-instance pcall isolates errors so one bad path doesn't abort the rest.
For many props on ONE instance use set_properties. For a single edit use set_property. For custom data use set_attribute / bulk_set_attributes (metadata).`,
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance paths'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        },
        propertyValue: {
          description: 'Value to set (string, number, boolean, or object for Vector3/Color3/UDim2)'
        }
      },
      required: ['paths', 'propertyName', 'propertyValue']
    }
  },
  {
    name: 'mass_get_property',
    feature: 'inspection_plus',
    category: 'read',
    description: 'Get a property from multiple instances',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance paths'
        },
        propertyName: {
          type: 'string',
          description: 'Property name'
        }
      },
      required: ['paths', 'propertyName']
    }
  },
  {
    name: 'set_properties',
    category: 'write',
    description: 'Set MANY properties on ONE instance in one call (N props, one instance). For one prop on many instances use mass_set_property (mutation_plus). For single edit use set_property.',
    descriptionLong: `Set MANY built-in properties on ONE instance. NOT atomic — each property is applied independently in pcall; failures DO NOT roll back already-applied properties. Response: results[]:{property,success,error?} plus summary:{total,succeeded,failed}.
Same value coercion as set_property (Vector3 array, Color3, Enum short name, Parent/PrimaryPart as dot-path, etc.). See set_property descriptionLong for full input value format reference.
For one prop on many instances use mass_set_property (mutation_plus). For one prop edit use set_property.`,
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path'
        },
        properties: {
          type: 'object',
          description: 'Map of property name to value'
        }
      },
      required: ['instancePath', 'properties']
    }
  },

  // === Object Creation/Deletion ===
  {
    name: 'create_object',
    category: 'write',
    description: 'Create a new instance. Optionally set properties on creation.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Roblox class name'
        },
        parent: {
          type: 'string',
          description: 'Parent instance path'
        },
        name: {
          type: 'string',
          description: 'Optional name'
        },
        properties: {
          type: 'object',
          description: 'Properties to set on creation'
        }
      },
      required: ['className', 'parent']
    }
  },
  {
    name: 'create_ui_tree',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Create an entire instance hierarchy from a nested JSON tree in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        parentPath: {
          type: 'string',
          description: 'Parent instance path'
        },
        tree: {
          type: 'object',
          description: 'Root node: { className: string, name?: string, properties?: { prop: value }, children?: [node, ...] }',
          properties: {
            className: { type: 'string', description: 'Roblox class name' },
            name: { type: 'string', description: 'Instance name' },
            properties: { type: 'object', description: 'Property name to value map' },
            children: {
              type: 'array',
              description: 'Child nodes with same structure',
              items: { type: 'object' }
            }
          },
          required: ['className']
        }
      },
      required: ['parentPath', 'tree']
    }
  },
  {
    name: 'mass_create_objects',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Create multiple instances. Each can have optional properties.',
    descriptionLong: `Create N instances in one call. Each entry: {className, parent (dot-path), name?, properties?}. NOT atomic — each entry is created independently; failures DO NOT roll back successful creates. Response: results[]:{success,className,parent,instancePath?,name?,error?} plus summary:{total,succeeded,failed}.
Properties are applied per-entry with the same coercion as create_object (Vector3 array, Color3, Enum short name, etc.). Per-property failures within an entry are silenced (pcall) — the instance is still created and parented.
For nested hierarchies prefer create_ui_tree (single tree, deeper nesting). For one creation use create_object.`,
    inputSchema: {
      type: 'object',
      properties: {
        objects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              className: {
                type: 'string',
                description: 'Roblox class name'
              },
              parent: {
                type: 'string',
                description: 'Parent instance path'
              },
              name: {
                type: 'string',
                description: 'Optional name'
              },
              properties: {
                type: 'object',
                description: 'Properties to set on creation'
              }
            },
            required: ['className', 'parent']
          },
          description: 'Objects to create'
        }
      },
      required: ['objects']
    }
  },
  {
    name: 'delete_object',
    category: 'write',
    description: 'Delete an instance. Cannot delete the game root. Undoable via undo. For bulk creation use mass_create_objects (mutation_plus); no bulk delete tool — call delete_object per instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        }
      },
      required: ['instancePath']
    }
  },

  // === Duplication ===
  {
    name: 'smart_duplicate',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Duplicate with naming, positioning, and property variations',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        count: {
          type: 'number',
          description: 'Number of duplicates'
        },
        options: {
          type: 'object',
          properties: {
            namePattern: {
              type: 'string',
              description: 'Name pattern ({n} placeholder)'
            },
            positionOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z offset per duplicate'
            },
            rotationOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z rotation offset'
            },
            scaleOffset: {
              type: 'array',
              items: { type: 'number' },
              description: 'X, Y, Z scale multiplier'
            },
            propertyVariations: {
              type: 'object',
              description: 'Property name to array of values'
            },
            targetParents: {
              type: 'array',
              items: { type: 'string' },
              description: 'Different parent per duplicate'
            }
          }
        }
      },
      required: ['instancePath', 'count']
    }
  },
  {
    name: 'mass_duplicate',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Batch smart_duplicate operations',
    inputSchema: {
      type: 'object',
      properties: {
        duplications: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              instancePath: {
                type: 'string',
                description: 'Instance path (dot notation)'
              },
              count: {
                type: 'number',
                description: 'Number of duplicates'
              },
              options: {
                type: 'object',
                properties: {
                  namePattern: {
                    type: 'string',
                    description: 'Name pattern ({n} placeholder)'
                  },
                  positionOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z offset per duplicate'
                  },
                  rotationOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z rotation offset'
                  },
                  scaleOffset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'X, Y, Z scale multiplier'
                  },
                  propertyVariations: {
                    type: 'object',
                    description: 'Property name to array of values'
                  },
                  targetParents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Different parent per duplicate'
                  }
                }
              }
            },
            required: ['instancePath', 'count']
          },
          description: 'Duplication operations'
        }
      },
      required: ['duplications']
    }
  },

  // === Calculated/Relative Properties ===
  // === Script Read/Write ===
  {
    name: 'get_script_outline',
    category: 'read',
    description: 'Get a compact symbol outline of a script: function names with signatures and line ranges, requires, and top-level locals. Read this first for a quick map; use get_script_source with startLine/endLine to drill into a specific function. Response includes knownHash — pass it back on re-reads to dedup unchanged outline.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response of this tool to dedup unchanged data — server returns {unchanged:true,knownHash}.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'get_script_source',
    category: 'read',
    description: 'Get script source with line numbers. Use startLine/endLine for large scripts. For an overview, prefer get_script_outline. Response includes knownHash — pass it back on re-reads (or pass the knownHash returned by edit_script_lines/insert_script_lines/delete_script_lines) to dedup unchanged source and skip resending the body.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path'
        },
        startLine: {
          type: 'number',
          description: 'Start line (1-indexed)'
        },
        endLine: {
          type: 'number',
          description: 'End line (inclusive)'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response of this tool to dedup unchanged data — server returns {unchanged:true,knownHash}.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'set_script_source',
    category: 'write',
    description: 'Replace ENTIRE script source (full rewrite). Prefer edit_script_lines for surgical edits. Project-wide replace: find_and_replace_in_scripts (scripting_plus). Line-based: insert/delete_script_lines (scripting_plus).',
    descriptionLong: 'Replace ENTIRE script source (full rewrite). For surgical single-block edits use edit_script_lines (preferred for most cases — preserves rest of file, supports validateAfter). For project-wide find/replace use find_and_replace_in_scripts (scripting_plus). For line-based inserts/deletes use insert_script_lines/delete_script_lines (scripting_plus).',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path'
        },
        source: {
          type: 'string',
          description: 'New source code'
        }
      },
      required: ['instancePath', 'source']
    }
  },
  {
    name: 'edit_script_lines',
    category: 'write',
    description: 'Surgical text replacement in a script (whitespace-sensitive, single match). Returns knownHash + replacedAtLine. Pass validateAfter:true for post-edit require/syntax check. Call get_tool_help for workflow, error codes, value formats.',
    descriptionLong: 'Replace exact text in a script (whitespace-sensitive, single replacement). Workflow: call get_script_source first to read current source verbatim, then copy old_string from that output (preserves tabs/CRLF). Returns {success, knownHash, replacedAtLine, linesDelta, newLineCount} — pass knownHash to subsequent get_script_source/get_script_outline on the same script to dedup. On failure: errorCode edit_no_match (with scriptLineCount, fuzzyMatchCount, scriptPreview, hint), edit_ambiguous (with matchLines), or empty_old_string. Identical old/new returns {success:true, noOp:true}. Pass validateAfter:true to clone+require ModuleScripts (or loadstring BaseScripts) post-edit and return validation:{ok, kind, error?}. For project-wide replace use find_and_replace_in_scripts; for full rewrite use set_script_source.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path (dot notation)'
        },
        old_string: {
          type: 'string',
          description: 'Exact text to find. Must be unique in the script. Whitespace and line-endings sensitive — copy from get_script_source output.'
        },
        new_string: {
          type: 'string',
          description: 'Replacement text.'
        },
        validateAfter: {
          type: 'boolean',
          description: 'If true, after applying the edit clone+require the ModuleScript (or loadstring BaseScript) to catch syntax/require-chain errors. Adds validation:{ok, kind:"syntax"|"require"|"clone", error?, line?, returnType?} to response. WARNING: require runs the module init code as a side effect — connections, spawned threads etc. will execute on the clone.'
        }
      },
      required: ['instancePath', 'old_string', 'new_string']
    }
  },
  {
    name: 'insert_script_lines',
    feature: 'scripting_plus',
    category: 'write',
    description: 'Insert lines after a given line number (0 = beginning).',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path'
        },
        afterLine: {
          type: 'number',
          description: 'Insert after this line (0 = beginning)'
        },
        newContent: {
          type: 'string',
          description: 'Content to insert'
        }
      },
      required: ['instancePath', 'newContent']
    }
  },
  {
    name: 'delete_script_lines',
    feature: 'scripting_plus',
    category: 'write',
    description: 'Delete a range of lines. 1-indexed, inclusive.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Script instance path'
        },
        startLine: {
          type: 'number',
          description: 'Start line (1-indexed)'
        },
        endLine: {
          type: 'number',
          description: 'End line (inclusive)'
        }
      },
      required: ['instancePath', 'startLine', 'endLine']
    }
  },

  // === Attributes ===
  {
    name: 'set_attribute',
    feature: 'metadata',
    category: 'write',
    description: 'Set an attribute. Supports primitives, Vector3, Color3, UDim2, BrickColor.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        attributeName: {
          type: 'string',
          description: 'Attribute name'
        },
        attributeValue: {
          description: 'Value (string, number, boolean, or object for Vector3/Color3/UDim2)'
        },
        valueType: {
          type: 'string',
          description: 'Type hint if needed'
        }
      },
      required: ['instancePath', 'attributeName', 'attributeValue']
    }
  },
  {
    name: 'get_attributes',
    feature: 'metadata',
    category: 'read',
    description: 'Get user-defined attributes on an instance (custom data). Different from built-in Roblox properties (use get_instance_properties) and CollectionService tags (use get_tags). Pass attributeName to read one (returns {value}); omit for all. Pass knownHash to dedup unchanged maps.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        attributeName: {
          type: 'string',
          description: 'Optional. If provided, returns just that attribute; otherwise returns all.'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response to dedup unchanged data — server returns {unchanged:true,knownHash}. Only applies when attributeName is omitted.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'delete_attribute',
    feature: 'metadata',
    category: 'write',
    description: 'Delete an attribute',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        attributeName: {
          type: 'string',
          description: 'Attribute name'
        }
      },
      required: ['instancePath', 'attributeName']
    }
  },

  // === Tags ===
  {
    name: 'get_tags',
    feature: 'metadata',
    category: 'read',
    description: 'Get CollectionService tags on an instance (string list). Different from attributes (custom user data, see get_attributes) and properties (built-in Roblox, see get_instance_properties).',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'add_tag',
    feature: 'metadata',
    category: 'write',
    description: 'Add a tag',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        tagName: {
          type: 'string',
          description: 'Tag name'
        }
      },
      required: ['instancePath', 'tagName']
    }
  },
  {
    name: 'remove_tag',
    feature: 'metadata',
    category: 'write',
    description: 'Remove a tag',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path (dot notation)'
        },
        tagName: {
          type: 'string',
          description: 'Tag name'
        }
      },
      required: ['instancePath', 'tagName']
    }
  },
  {
    name: 'get_tagged',
    feature: 'metadata',
    category: 'read',
    description: 'Get all instances with a specific tag',
    inputSchema: {
      type: 'object',
      properties: {
        tagName: {
          type: 'string',
          description: 'Tag name'
        }
      },
      required: ['tagName']
    }
  },

  // === Selection ===
  {
    name: 'get_selection',
    category: 'read',
    description: 'Get all currently selected objects',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // === Luau Execution ===
  {
    name: 'execute_luau',
    category: 'write',
    description: 'Execute Luau code in plugin context. print()/warn() captured to output. Return value JSON-encoded (tables preserved). Requires connected target — fails fast with target_not_connected if unavailable. Call get_tool_help for fallback alternatives.',
    descriptionLong: 'Execute Luau code in plugin context. Use print()/warn() for output. Return value is JSON-encoded (tables preserved). Requires connected target — pre-validates against connected instances and fails fast with errorCode: target_not_connected if unavailable. For code validation only (syntax/require), prefer get_script_analysis (scripting_plus feature) — works without a target. For ModuleScript fresh-require validation after edits, use edit_script_lines with validateAfter:true instead of manual clone+require.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Luau code to execute'
        },
        target: {
          type: 'string',
          description: 'Instance target: "edit" (default), "server", "client-1", "client-2", etc.'
        }
      },
      required: ['code']
    }
  },

  // === Script Search ===
  {
    name: 'grep_scripts',
    category: 'read',
    description: 'Search across all script sources (literal or Lua pattern). Results grouped by script with line/column. Use for: finding code patterns, post-edit verification ("does old text still exist?"), locating callers/usages. For navigation by symbol use get_script_outline. For project-wide replace use find_and_replace_in_scripts (scripting_plus).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (literal string or Lua pattern)'
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)'
        },
        usePattern: {
          type: 'boolean',
          description: 'Use Lua pattern matching instead of literal (default: false)'
        },
        contextLines: {
          type: 'number',
          description: 'Number of context lines before/after each match (default: 0)'
        },
        maxResults: {
          type: 'number',
          description: 'Max total matches before stopping (default: 30)'
        },
        maxResultsPerScript: {
          type: 'number',
          description: 'Max matches per script (like rg -m)'
        },
        filesOnly: {
          type: 'boolean',
          description: 'Only return matching script paths, not line details (default: false)'
        },
        path: {
          type: 'string',
          description: 'Subtree to search (e.g. "game.ServerScriptService")'
        },
        classFilter: {
          type: 'string',
          enum: ['Script', 'LocalScript', 'ModuleScript'],
          description: 'Only search scripts of this class type'
        }
      },
      required: ['pattern']
    }
  },

  // === Playtest ===
  {
    name: 'start_playtest',
    feature: 'playtest',
    category: 'write',
    description: 'Start playtest. Captures print/warn/error via LogService. Poll with get_playtest_output, end with stop_playtest. Use numPlayers for multi-client testing (server + N clients).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['play', 'run'],
          description: 'Play mode'
        },
        numPlayers: {
          type: 'number',
          description: 'Number of client players (1-8). Triggers server + clients mode via TestService.'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'stop_playtest',
    feature: 'playtest',
    category: 'write',
    description: 'Stop playtest and return all captured output.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_playtest_output',
    feature: 'playtest',
    category: 'read',
    description: 'Poll output buffer without stopping. Returns isRunning and captured messages.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Instance target: "edit" (default), "server", "client-1", "client-2", etc.'
        }
      }
    }
  },

  // === Multi-Instance ===
  {
    name: 'get_connected_instances',
    feature: 'playtest',
    category: 'read',
    description: 'List all connected plugin instances with their roles. Use during multi-client playtest to discover server and client instances for targeted commands.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // === Undo/Redo ===
  {
    name: 'undo',
    category: 'write',
    description: 'Undo the last change in Roblox Studio. Uses ChangeHistoryService to reverse the most recent operation.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'redo',
    feature: 'mutation_plus',
    category: 'write',
    description: 'Redo the last undone change in Roblox Studio. Uses ChangeHistoryService to reapply the most recently undone operation.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // === Build Library ===
  {
    name: 'export_build',
    feature: 'builds',
    category: 'read',
    description: 'Export a Model/Folder to compact build JSON in the local library (build-library/{style}/{id}.json). Output has a palette (BrickColor+Material → short keys) and parts with positions relative to bounding box center.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Path to the Model or Folder to export (dot notation)'
        },
        outputId: {
          type: 'string',
          description: 'Build ID for the output (e.g. "medieval/cottage_01"). Defaults to style/instance_name.'
        },
        style: {
          type: 'string',
          enum: ['medieval', 'modern', 'nature', 'scifi', 'misc'],
          description: 'Style category for the build (default: misc)'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'create_build',
    feature: 'builds',
    category: 'write',
    description: 'Create a build from scratch and save to library. Parts in object or tuple form, palette maps keys to [BrickColor, Material]. Call get_tool_help for tuple layout and palette examples.',
    descriptionLong: 'Create a build from scratch and save to the library. Parts: object form {position,size,rotation,paletteKey,shape?,transparency?} or tuple [posX,posY,posZ,sizeX,sizeY,sizeZ,rotX,rotY,rotZ,paletteKey,shape?,transparency?]. Palette maps keys to [BrickColor, Material] pairs (or [BrickColor, Material, MaterialVariant] triples). Example palette: {"a":["Dark stone grey","Concrete"],"b":["Brown","Wood","MyCustomWood"]}.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Build ID including style prefix (e.g. "medieval/torch_01", "nature/bush_small")'
        },
        style: {
          type: 'string',
          enum: ['medieval', 'modern', 'nature', 'scifi', 'misc'],
          description: 'Style category'
        },
        palette: {
          type: 'object',
          description: 'Keys → [BrickColor, Material] or [BrickColor, Material, MaterialVariant]. Example: {"a":["Dark stone grey","Concrete"],"b":["Brown","Wood","MyCustomWood"]}'
        },
        parts: {
          type: 'array',
          description: 'Array of parts. Object format: {position:[x,y,z], size:[x,y,z], rotation:[x,y,z], paletteKey, shape?, transparency?}. Tuple format [posX,posY,posZ,sizeX,sizeY,sizeZ,rotX,rotY,rotZ,paletteKey,shape?,transparency?] also accepted.',
          items: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['position', 'size', 'rotation', 'paletteKey'],
                properties: {
                  position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                  size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                  rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                  paletteKey: { type: 'string', minLength: 1 },
                  shape: { type: 'string', enum: ['Block', 'Wedge', 'Cylinder', 'Ball', 'CornerWedge'] },
                  transparency: { type: 'number', minimum: 0, maximum: 1 }
                }
              },
              {
                type: 'array',
                minItems: 10,
                items: { anyOf: [{ type: 'number' }, { type: 'string' }] }
              }
            ]
          }
        },
        bounds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional bounding box [X, Y, Z]. Auto-computed if omitted.'
        }
      },
      required: ['id', 'style', 'palette', 'parts']
    }
  },
  {
    name: 'generate_build',
    feature: 'builds',
    category: 'write',
    description: 'Procedurally generate a build via JS code (one call, whole scene). High-level primitives: room, roof, stairs, column, pew, arch, fence. Basic: part, rpart, wall, floor, fill, beam. Repetition: row, grid. Max 10000 parts. Call get_tool_help for full primitive reference.',
    descriptionLong: `Procedurally generate a build via JS code. Generate the entire scene in ONE call. Prefer high-level primitives over manual loops. No comments, no extra vars.
EDITING: call get_build first, then change only what the user asked.

HIGH-LEVEL (each replaces 5-20 lines):
  room(x,y,z,w,h,d,wallKey,floorKey?,ceilKey?,wallThickness?) — floor+ceiling+4 walls
  roof(x,y,z,w,d,style,key,overhang?) — style: "flat"|"gable"|"hip"
  stairs(x1,y1,z1,x2,y2,z2,width,key) — steps between two points
  column(x,y,z,height,radius,key,capKey?)
  pew(x,y,z,w,d,seatKey,legKey?)
  arch(x,y,z,w,h,thickness,key,segments?)
  fence(x1,z1,x2,z2,y,key,postSpacing?)

BASIC:
  part(x,y,z,sx,sy,sz,key,shape?,transparency?)
  rpart(x,y,z,sx,sy,sz,rx,ry,rz,key,shape?,transparency?)
  wall(x1,z1,x2,z2,height,thickness,key) — vertical plane
  floor(x1,z1,x2,z2,y,thickness,key) — horizontal plane (2D corners + y)
  fill(x1,y1,z1,x2,y2,z2,key,[ux,uy,uz]?) — 3D volume between two points
  beam(x1,y1,z1,x2,y2,z2,thickness,key)

REPETITION:
  row(x,y,z,count,spacingX,spacingZ,fn(i,cx,cy,cz))
  grid(x,y,z,countX,countZ,spacingX,spacingZ,fn(ix,iz,cx,cy,cz))

Shapes: Block(default), Wedge, Cylinder, Ball, CornerWedge. Max 10000 parts. Math and rng() available.
Palette keys must match exactly (no raw color names). Cylinders extend along X — for upright use size (h,d,d) with rz=90 (column() handles this).
Custom materials: search_materials → use as 3rd palette element {"a":["Color","BaseMaterial","VariantName"]}.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Build ID including style prefix (e.g. "medieval/church_01")'
        },
        style: {
          type: 'string',
          enum: ['medieval', 'modern', 'nature', 'scifi', 'misc'],
          description: 'Style category'
        },
        palette: {
          type: 'object',
          description: 'Keys → [BrickColor, Material] or [BrickColor, Material, MaterialVariant]. MaterialVariant references MaterialService entries (find via search_materials).'
        },
        code: {
          type: 'string',
          description: 'JavaScript code using the primitives above to generate parts procedurally'
        },
        seed: {
          type: 'number',
          description: 'Optional seed for deterministic rng() output (default: 42)'
        }
      },
      required: ['id', 'style', 'palette', 'code']
    }
  },
  {
    name: 'import_build',
    feature: 'builds',
    category: 'write',
    description: 'Import a build into Roblox Studio. Accepts either a full build data object OR a library ID string (e.g. "medieval/church_01") to load from the build library. When using generate_build or create_build, pass the build ID string instead of the full data.',
    inputSchema: {
      type: 'object',
      properties: {
        buildData: {
          description: 'Either a build data object (with palette, parts, etc.) OR a library ID string (e.g. "medieval/church_01") to load from the build library'
        },
        targetPath: {
          type: 'string',
          description: 'Parent instance path where the model will be created'
        },
        position: {
          type: 'array',
          items: { type: 'number' },
          description: 'World position offset [X, Y, Z]'
        }
      },
      required: ['buildData', 'targetPath']
    }
  },
  {
    name: 'list_library',
    feature: 'builds',
    category: 'read',
    description: 'List available builds in the local build library. Returns build IDs, styles, bounds, and part counts. Optionally filter by style.',
    inputSchema: {
      type: 'object',
      properties: {
        style: {
          type: 'string',
          enum: ['medieval', 'modern', 'nature', 'scifi', 'misc'],
          description: 'Filter by style category'
        }
      }
    }
  },
  {
    name: 'search_materials',
    feature: 'builds',
    category: 'read',
    description: 'Search for MaterialVariant instances in MaterialService by name. Use this to find custom materials before using them in generate_build or create_build palettes. Returns material names and their base material types.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to match against material names (case-insensitive). Leave empty to list all.'
        },
        maxResults: {
          type: 'number',
          description: 'Max results to return (default: 50)'
        }
      }
    }
  },
  {
    name: 'get_build',
    feature: 'builds',
    category: 'read',
    description: 'Get a build from the library by ID. Returns metadata, palette, and generator code (if the build was created with generate_build). IMPORTANT: When the user asks to modify an existing build, ALWAYS call get_build first to retrieve the original code, then make targeted edits to only the relevant lines, and call generate_build with the modified code. Never rewrite the entire code from scratch — only change what the user asked to change.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Build ID (e.g. "medieval/church_01")'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'import_scene',
    feature: 'builds',
    category: 'write',
    description: 'Import a full scene layout. Provide a scene with model references (resolved from library) and placement data. Each model is placed at the specified position/rotation. Can also include inline custom builds.',
    inputSchema: {
      type: 'object',
      properties: {
        sceneData: {
          type: 'object',
          description: 'Scene layout object with: models (map of key to library build ID), place (array of [key, position, rotation?]), and optional custom (array of inline build objects with name, position, palette, parts)',
          properties: {
            models: {
              type: 'object',
              description: 'Map of short keys to library build IDs (e.g. {"A": "medieval/cottage_01"})'
            },
            place: {
              type: 'array',
              description: 'Array of placements. Preferred format: {modelKey, position:[x,y,z], rotation?:[x,y,z]}. Legacy tuple format [modelKey, [x,y,z], [rotX?,rotY?,rotZ?]] is also accepted.',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['modelKey', 'position'],
                    properties: {
                      modelKey: {
                        type: 'string'
                      },
                      position: {
                        type: 'array',
                        items: { type: 'number' }
                      },
                      rotation: {
                        type: 'array',
                        items: { type: 'number' }
                      }
                    }
                  },
                  {
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string'
                        },
                        {
                          type: 'array',
                          items: { type: 'number' }
                        }
                      ]
                    }
                  }
                ]
              }
            },
            custom: {
              type: 'array',
              description: 'Array of inline custom builds with {n: name, o: [x,y,z], palette: {...}, parts: [...]}',
              items: { type: 'object' }
            }
          }
        },
        targetPath: {
          type: 'string',
          description: 'Parent instance path for the scene (default: game.Workspace)'
        }
      },
      required: ['sceneData']
    }
  },

  // === Asset Tools ===
  {
    name: 'search_assets',
    feature: 'assets',
    category: 'read',
    description: 'Search the Creator Store (Roblox marketplace) for assets by type and keywords. Requires ROBLOX_OPEN_CLOUD_API_KEY env var (no cookie auth for this endpoint).',
    inputSchema: {
      type: 'object',
      properties: {
        assetType: {
          type: 'string',
          enum: ['Audio', 'Model', 'Decal', 'Plugin', 'MeshPart', 'Video', 'FontFamily'],
          description: 'Type of asset to search for'
        },
        query: {
          type: 'string',
          description: 'Search keywords'
        },
        maxResults: {
          type: 'number',
          description: 'Max results to return (default: 25)'
        },
        sortBy: {
          type: 'string',
          enum: ['Relevance', 'Trending', 'Top', 'AudioDuration', 'CreateTime', 'UpdatedTime', 'Ratings'],
          description: 'Sort order (default: Relevance)'
        },
        verifiedCreatorsOnly: {
          type: 'boolean',
          description: 'Only show assets from verified creators (default: false)'
        }
      },
      required: ['assetType']
    }
  },
  {
    name: 'get_asset_details',
    feature: 'assets',
    category: 'read',
    description: 'Get detailed marketplace metadata for a specific asset. Uses ROBLOX_OPEN_CLOUD_API_KEY or falls back to ROBLOSECURITY cookie (own assets only).',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'number',
          description: 'The Roblox asset ID'
        }
      },
      required: ['assetId']
    }
  },
  {
    name: 'get_asset_thumbnail',
    feature: 'assets',
    category: 'read',
    description: 'Get the thumbnail image for an asset as base64 PNG, suitable for vision LLMs. Thumbnails API is public but asset validation uses ROBLOX_OPEN_CLOUD_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'number',
          description: 'The Roblox asset ID'
        },
        size: {
          type: 'string',
          enum: ['150x150', '420x420', '768x432'],
          description: 'Thumbnail size (default: 420x420)'
        }
      },
      required: ['assetId']
    }
  },
  {
    name: 'insert_asset',
    feature: 'assets',
    category: 'write',
    description: 'Insert a Roblox asset into Studio by loading it via AssetService and parenting it to a target location. Optionally set position.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'number',
          description: 'The Roblox asset ID to insert'
        },
        parentPath: {
          type: 'string',
          description: 'Parent instance path (default: game.Workspace)'
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' }
          },
          description: 'Optional world position to place the asset'
        }
      },
      required: ['assetId']
    }
  },
  {
    name: 'preview_asset',
    feature: 'assets',
    category: 'read',
    description: 'Preview a Roblox asset without permanently inserting it. Loads the asset, builds a hierarchy tree with properties and summary stats, then destroys it. Useful for inspecting asset contents before insertion.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'number',
          description: 'The Roblox asset ID to preview'
        },
        includeProperties: {
          type: 'boolean',
          description: 'Include detailed properties for each instance (default: true)'
        },
        maxDepth: {
          type: 'number',
          description: 'Max hierarchy traversal depth (default: 10)'
        }
      },
      required: ['assetId']
    }
  },
  {
    name: 'upload_decal',
    feature: 'assets',
    category: 'write',
    description: 'Upload an image file as a Decal asset to Roblox. Supports ROBLOSECURITY cookie auth (recommended, simpler) or ROBLOX_OPEN_CLOUD_API_KEY (needs asset:write scope + creator ID). Cookie auth is used automatically when ROBLOSECURITY is set.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the image file on disk (PNG, JPG, BMP, or TGA)'
        },
        displayName: {
          type: 'string',
          description: 'Display name for the decal asset (max 50 characters)'
        },
        description: {
          type: 'string',
          description: 'Description for the decal asset (default: empty string)'
        },
        userId: {
          type: 'string',
          description: 'Roblox user ID for the asset creator. Overrides ROBLOX_CREATOR_USER_ID env var.'
        },
        groupId: {
          type: 'string',
          description: 'Roblox group ID for the asset creator. Overrides ROBLOX_CREATOR_GROUP_ID env var. Takes precedence over userId if both provided.'
        }
      },
      required: ['filePath', 'displayName']
    }
  },
  {
    name: 'capture_screenshot',
    feature: 'capture',
    category: 'read',
    description: 'Capture a screenshot of the Roblox Studio viewport and return it as a PNG image. Requires EditableImage API to be enabled: Game Settings > Security > "Allow Mesh / Image APIs". Only works in Edit mode with the viewport visible.',
    inputSchema: {
      type: 'object',
      properties: {},
    }
  },

  // === Input Simulation ===
  {
    name: 'simulate_mouse_input',
    feature: 'capture',
    category: 'write',
    description: 'Simulate mouse input in the Roblox Studio viewport via VirtualInputManager. Use during playtest to click UI buttons, interact with objects, or navigate menus. Coordinates are viewport pixels (top-left is 0,0). Use capture_screenshot to identify UI element positions before clicking.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'mouseDown', 'mouseUp', 'move', 'scroll'],
          description: 'Mouse action to perform. "click" does mouseDown + short delay + mouseUp.'
        },
        x: {
          type: 'number',
          description: 'Viewport pixel X coordinate'
        },
        y: {
          type: 'number',
          description: 'Viewport pixel Y coordinate'
        },
        button: {
          type: 'string',
          enum: ['Left', 'Right', 'Middle'],
          description: 'Mouse button (default: Left)'
        },
        scrollDirection: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Scroll direction (only for "scroll" action)'
        },
        target: {
          type: 'string',
          description: 'Instance target: "edit" (default), "server", "client-1", "client-2", etc.'
        }
      },
      required: ['action', 'x', 'y']
    }
  },
  {
    name: 'simulate_keyboard_input',
    feature: 'capture',
    category: 'write',
    description: 'Simulate keyboard input via VirtualInputManager. Use during playtest for character movement (W/A/S/D), jumping (Space), interactions (E), or any key-driven action. For sustained movement, use "press" to hold and "release" to let go.',
    inputSchema: {
      type: 'object',
      properties: {
        keyCode: {
          type: 'string',
          description: 'Enum.KeyCode name: "W", "A", "S", "D", "Space", "E", "F", "LeftShift", "LeftControl", "Return", "Tab", "Escape", "One", "Two", etc.'
        },
        action: {
          type: 'string',
          enum: ['press', 'release', 'tap'],
          description: '"tap" (default) = press + wait + release. "press" = key down only. "release" = key up only.'
        },
        duration: {
          type: 'number',
          description: 'Hold duration in seconds for "tap" action (default: 0.1). Use longer values for sustained input like walking.'
        },
        target: {
          type: 'string',
          description: 'Instance target: "edit" (default), "server", "client-1", "client-2", etc.'
        }
      },
      required: ['keyCode']
    }
  },

  // === Character Navigation ===
  {
    name: 'character_navigation',
    feature: 'capture',
    category: 'write',
    description: 'Move the player character to a target position or instance during playtest. Uses PathfindingService for automatic navigation around obstacles, falling back to direct movement. Requires an active playtest in "play" mode. Does NOT simulate player input — moves the character directly.',
    inputSchema: {
      type: 'object',
      properties: {
        position: {
          type: 'array',
          items: { type: 'number' },
          description: 'Target world position [x, y, z]. Either this or instancePath is required.'
        },
        instancePath: {
          type: 'string',
          description: 'Instance to navigate to (dot notation). The character walks to its Position. Either this or position is required.'
        },
        waitForCompletion: {
          type: 'boolean',
          description: 'Wait for the character to arrive before returning (default: true)'
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for navigation to complete (default: 25)'
        },
        target: {
          type: 'string',
          description: 'Instance target: "edit" (default), "server", "client-1", "client-2", etc.'
        }
      }
    }
  },

  // === Instance Operations ===
  {
    name: 'clone_object',
    category: 'write',
    description: 'Clone an instance to a new parent location. Creates a deep copy of the instance and all its descendants.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Path of the instance to clone'
        },
        targetParentPath: {
          type: 'string',
          description: 'Path of the parent to place the clone under'
        }
      },
      required: ['instancePath', 'targetParentPath']
    }
  },
  {
    name: 'move_object',
    category: 'write',
    description: 'Move (reparent) an instance to a new parent location. Preserves all children and properties.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Path of the instance to move'
        },
        targetParentPath: {
          type: 'string',
          description: 'Path of the new parent'
        }
      },
      required: ['instancePath', 'targetParentPath']
    }
  },
  {
    name: 'rename_object',
    category: 'write',
    description: 'Rename an instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Path of the instance to rename'
        },
        newName: {
          type: 'string',
          description: 'New name for the instance'
        }
      },
      required: ['instancePath', 'newName']
    }
  },

  // === Descendants & Comparison ===
  {
    name: 'get_descendants',
    feature: 'inspection_plus',
    category: 'read',
    description: 'Get all descendants of an instance recursively with depth info. More efficient than repeated get_instance_children calls. Pass knownHash to dedup unchanged trees (returns {unchanged:true,knownHash}).',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Root instance path'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 10)'
        },
        classFilter: {
          type: 'string',
          description: 'Only include instances of this class (uses IsA, so "BasePart" matches Part, MeshPart, etc.)'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response to dedup unchanged descendants list — server returns {unchanged:true,knownHash}.'
        }
      },
      required: ['instancePath']
    }
  },
  {
    name: 'compare_instances',
    feature: 'inspection_plus',
    category: 'read',
    description: 'Diff two instances by comparing their properties. Useful for debugging why a duplicate behaves differently.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePathA: {
          type: 'string',
          description: 'First instance path'
        },
        instancePathB: {
          type: 'string',
          description: 'Second instance path'
        }
      },
      required: ['instancePathA', 'instancePathB']
    }
  },

  // === Output & Diagnostics ===
  {
    name: 'get_output_log',
    feature: 'inspection_plus',
    category: 'read',
    description: 'Get the Studio output log history. Works in both edit and play mode. Pass knownHash to dedup polled output (returns {unchanged:true,knownHash} when log unchanged since prior call) — useful when polling for new output during long-running tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        maxEntries: {
          type: 'number',
          description: 'Maximum number of log entries to return (default: 100)'
        },
        messageType: {
          type: 'string',
          description: 'Filter by message type (e.g. "Enum.MessageType.MessageOutput", "Enum.MessageType.MessageWarning", "Enum.MessageType.MessageError")'
        },
        knownHash: {
          type: 'string',
          description: 'Pass knownHash from a prior response to dedup unchanged log — server returns {unchanged:true,knownHash}. Useful when polling.'
        }
      }
    }
  },
  {
    name: 'get_script_analysis',
    feature: 'scripting_plus',
    category: 'read',
    description: 'Run syntax analysis on Luau scripts using loadstring. Detects compile errors with line numbers. Pass a script path to analyze one script, or a container path to analyze all scripts under it.',
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path - either a script or a container whose descendant scripts will be analyzed'
        }
      },
      required: ['instancePath']
    }
  },

  // === Bulk Attributes ===
  {
    name: 'bulk_set_attributes',
    feature: 'metadata',
    category: 'write',
    description: 'Set multiple attributes on an instance in a single call. More efficient than repeated set_attribute calls.',
    descriptionLong: `Set N attributes on ONE instance (custom user data, NOT built-in props — for those use set_properties). NOT atomic — each attribute is written independently in pcall; failures DO NOT roll back. Response: results[]:{attribute,success,error?} plus summary:{total,succeeded,failed}.
Values: primitives + Vector3/Color3/UDim2/BrickColor via _type tag in deserialization (e.g. {_type:"Vector3",X,Y,Z}). For Roblox built-in properties use set_properties / set_property; for CollectionService tags use add_tag / remove_tag.`,
    inputSchema: {
      type: 'object',
      properties: {
        instancePath: {
          type: 'string',
          description: 'Instance path'
        },
        attributes: {
          type: 'object',
          description: 'Map of attribute names to values. Supports Vector3, Color3, UDim2 via _type convention.'
        }
      },
      required: ['instancePath', 'attributes']
    }
  },

  // === Find and Replace ===
  {
    name: 'find_and_replace_in_scripts',
    feature: 'scripting_plus',
    category: 'write',
    description: 'PROJECT-WIDE find/replace across many scripts. Supports literal and Lua pattern matching. Use dryRun to preview before applying. For SINGLE-script targeted edit prefer edit_script_lines (safer, returns knownHash + validation). Pairs with grep_scripts for search-only.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text or Lua pattern to find'
        },
        replacement: {
          type: 'string',
          description: 'Replacement text. When usePattern is true, supports Lua captures (%1, %2, etc.).'
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive matching (default: false). Must be true when usePattern is true.'
        },
        usePattern: {
          type: 'boolean',
          description: 'Use Lua pattern matching instead of literal (default: false). Requires caseSensitive: true.'
        },
        path: {
          type: 'string',
          description: 'Limit scope to a subtree (e.g. "game.ServerScriptService")'
        },
        classFilter: {
          type: 'string',
          enum: ['Script', 'LocalScript', 'ModuleScript'],
          description: 'Only search scripts of this class type'
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without applying them (default: false)'
        },
        maxReplacements: {
          type: 'number',
          description: 'Safety limit on total replacements (default: 1000)'
        }
      },
      required: ['pattern', 'replacement']
    }
  },
];

export const getReadOnlyTools = () => TOOL_DEFINITIONS.filter(t => t.category === 'read');
export const getAllTools = () => [...TOOL_DEFINITIONS];
