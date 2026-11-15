require 'xcodeproj'
root = File.expand_path('..', __dir__)
path = File.join(root, 'ContextualLearning.xcodeproj')
project = Xcodeproj::Project.new(path)
project.root_object.attributes['LastUpgradeCheck'] = '1600'
project.build_configurations.each do |config|
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
end
app = project.new_target(:application, 'ContextualLearning', :ios, '17.0')
unit = project.new_target(:unit_test_bundle, 'ContextualLearningTests', :ios, '17.0')
ui = project.new_target(:ui_test_bundle, 'ContextualLearningUITests', :ios, '17.0')
unit.add_dependency(app)
ui.add_dependency(app)
[app, unit, ui].each do |target|
  target.build_configurations.each do |config|
    config.build_settings['SWIFT_VERSION'] = '5.0'
    config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'dev.contextual.language-learning.' + (target == app ? 'reader' : target.name.downcase)
  end
end
app.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = '$(IOS_BUNDLE_IDENTIFIER)'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'NO'
  config.build_settings['INFOPLIST_FILE'] = 'Config/Info.plist'
  config.build_settings['MARKETING_VERSION'] = '0.1.0'
  config.build_settings['CURRENT_PROJECT_VERSION'] = '1'
  config.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  config.build_settings['INFOPLIST_KEY_CFBundleDisplayName'] = 'Contextual Learning'
  config.build_settings['INFOPLIST_KEY_UIApplicationSceneManifest_Generation'] = 'YES'
  config.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES'
  config.build_settings['INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone'] = 'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'
  config.build_settings['INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad'] = 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'
  config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
end
verify = app.new_shell_script_build_phase('Verify bundled lesson contract')
app.build_phases.move(verify, 0)
verify.shell_script = 'cd "$SRCROOT/../.." && /usr/bin/python3 apps/ios/scripts/verify-contract.py'
config_group = project.main_group.new_group('Config', 'Config')
app_config = config_group.new_file('App.xcconfig')
config_group.new_file('Info.plist')
app.build_configurations.each { |config| config.base_configuration_reference = app_config }
package = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
package.repositoryURL = 'https://github.com/google/GoogleSignIn-iOS'
package.requirement = { 'kind' => 'exactVersion', 'version' => '9.2.0' }
project.root_object.package_references << package
['GoogleSignIn', 'GoogleSignInSwift'].each do |name|
  product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  product.package = package
  product.product_name = name
  app.package_product_dependencies << product
  build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  build_file.product_ref = product
  app.frameworks_build_phase.files << build_file
end
unit.build_configurations.each do |config|
  config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/ContextualLearning.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/ContextualLearning'
  config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
end
ui.build_configurations.each { |config| config.build_settings['TEST_TARGET_NAME'] = 'ContextualLearning' }
{'ContextualLearning' => app, 'ContextualLearningTests' => unit, 'ContextualLearningUITests' => ui}.each do |folder, target|
  group = project.main_group.new_group(folder, folder)
  Dir.glob(File.join(root, folder, '**', '*')).sort.each do |file|
    next if file.include?('.xcassets/')
    next if File.directory?(file) && !file.end_with?('.xcassets')
    relative = file.delete_prefix(File.join(root, folder) + '/')
    reference = group.new_file(relative)
    if file.end_with?('.swift')
      target.source_build_phase.add_file_reference(reference)
    else
      target.resources_build_phase.add_file_reference(reference)
    end
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(unit)
scheme.add_test_target(ui)
scheme.set_launch_target(app)
scheme.save_as(path, 'ContextualLearning', true)
puts path
